package llm

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
)

// Manager manages multiple LLM backends
type Manager struct {
	backends map[string]Backend
	primary  Backend
	db       *sql.DB
	mu       sync.RWMutex
}

// NewManager creates a new backend manager
func NewManager(db *sql.DB) *Manager {
	return &Manager{
		backends: make(map[string]Backend),
		db:       db,
	}
}

// RegisterBackend adds a backend to the manager
func (m *Manager) RegisterBackend(backend Backend) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	name := backend.Name()
	if _, exists := m.backends[name]; exists {
		return fmt.Errorf("backend %q already registered", name)
	}

	m.backends[name] = backend

	// Set as primary if it's the first backend
	if m.primary == nil {
		m.primary = backend
	}

	return nil
}

// SetPrimary sets the primary backend by name and persists to database
func (m *Manager) SetPrimary(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	backend, exists := m.backends[name]
	if !exists {
		return fmt.Errorf("backend %q not found", name)
	}

	m.primary = backend

	// Persist to database if available
	if m.db != nil {
		if err := m.persistPrimary(name); err != nil {
			return fmt.Errorf("failed to persist primary backend: %w", err)
		}
	}

	return nil
}

// persistPrimary saves the primary backend setting to the database
func (m *Manager) persistPrimary(name string) error {
	_, err := m.db.Exec(`
		INSERT INTO settings (key, value) VALUES ('primary_backend', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, name)
	return err
}

// loadPrimary loads the primary backend setting from the database
func (m *Manager) loadPrimary() (string, error) {
	var name string
	err := m.db.QueryRow(`SELECT value FROM settings WHERE key = 'primary_backend'`).Scan(&name)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return name, err
}

// Primary returns the primary backend
func (m *Manager) Primary() Backend {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.primary
}

// Get retrieves a backend by name
func (m *Manager) Get(name string) (Backend, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	backend, exists := m.backends[name]
	return backend, exists
}

// List returns all registered backends
func (m *Manager) List() []Backend {
	m.mu.RLock()
	defer m.mu.RUnlock()

	backends := make([]Backend, 0, len(m.backends))
	for _, b := range m.backends {
		backends = append(backends, b)
	}
	return backends
}

// BackendInfo represents backend information for API responses
type BackendInfo struct {
	Name      string      `json:"name"`
	Type      BackendType `json:"type"`
	Available bool        `json:"available"`
	Primary   bool        `json:"primary"`
}

// ListInfo returns all backends with their availability status
func (m *Manager) ListInfo(ctx context.Context) []BackendInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	infos := make([]BackendInfo, 0, len(m.backends))
	for _, b := range m.backends {
		info := BackendInfo{
			Name:      b.Name(),
			Type:      b.Type(),
			Available: b.Ping(ctx) == nil,
			Primary:   m.primary != nil && b.Name() == m.primary.Name(),
		}
		infos = append(infos, info)
	}
	return infos
}

// InitFromConfig initializes backends from configuration using the provided factory
func (m *Manager) InitFromConfig(cfg *Config, factory BackendFactory) error {
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}

	// Create and register backends
	for i := range cfg.Backends {
		bcfg := &cfg.Backends[i]
		if !bcfg.Enabled {
			continue
		}

		backend, err := factory.Create(bcfg)
		if err != nil {
			return fmt.Errorf("failed to create backend %q: %w", bcfg.Name, err)
		}

		if err := m.RegisterBackend(backend); err != nil {
			return fmt.Errorf("failed to register backend %q: %w", bcfg.Name, err)
		}

		// Set as primary if configured
		if bcfg.Primary {
			m.mu.Lock()
			m.primary = backend
			m.mu.Unlock()
		}
	}

	// Try to load persisted primary from database
	if m.db != nil {
		if name, err := m.loadPrimary(); err == nil && name != "" {
			if backend, exists := m.backends[name]; exists {
				m.mu.Lock()
				m.primary = backend
				m.mu.Unlock()
			}
		}
	}

	// Fall back to default backend from config
	if m.primary == nil && cfg.DefaultBackend != "" {
		if backend, exists := m.backends[cfg.DefaultBackend]; exists {
			m.mu.Lock()
			m.primary = backend
			m.mu.Unlock()
		}
	}

	return nil
}

// Close releases resources for all backends
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var errs []error
	for name, backend := range m.backends {
		if err := backend.Close(); err != nil {
			errs = append(errs, fmt.Errorf("backend %q: %w", name, err))
		}
	}

	m.backends = make(map[string]Backend)
	m.primary = nil

	if len(errs) > 0 {
		return fmt.Errorf("errors closing backends: %v", errs)
	}
	return nil
}
