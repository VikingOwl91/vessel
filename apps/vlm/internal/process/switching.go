package process

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/vikingowl91/vessel/apps/vlm/internal/config"
)

// Switcher handles safe model switching using start-new-then-swap pattern.
// This prevents users from being left with no model if a switch fails.
type Switcher struct {
	cfg    *config.Config
	logger *slog.Logger

	mu      sync.RWMutex
	current *Manager // Currently active process
	pending *Manager // Process being started during switch
}

// NewSwitcher creates a new model switcher.
func NewSwitcher(cfg *config.Config) *Switcher {
	return &Switcher{
		cfg:    cfg,
		logger: slog.Default().With("component", "switcher"),
	}
}

// SwitchResult contains the result of a model switch operation.
type SwitchResult struct {
	Success     bool   `json:"success"`
	ModelID     string `json:"model_id,omitempty"`
	ProfileName string `json:"profile_name,omitempty"`
	Port        int    `json:"port,omitempty"`
	Error       string `json:"error,omitempty"`
}

// Switch loads a model using the start-new-then-swap pattern.
// 1. Start new llama-server on ephemeral port
// 2. Wait for readiness
// 3. Atomically swap the active process
// 4. Stop the old process
func (s *Switcher) Switch(ctx context.Context, modelPath, modelID, profileName string) (*SwitchResult, error) {
	s.logger.Info("initiating model switch",
		"model_id", modelID,
		"model_path", modelPath,
		"profile", profileName,
	)

	// Get the profile
	profile := s.cfg.GetProfile(profileName)
	if profile == nil {
		return &SwitchResult{
			Success: false,
			Error:   fmt.Sprintf("profile not found: %s", profileName),
		}, fmt.Errorf("profile not found: %s", profileName)
	}

	// Create new process manager
	newManager, err := NewManager(profile, s.cfg)
	if err != nil {
		return &SwitchResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	// Mark as pending
	s.mu.Lock()
	s.pending = newManager
	s.mu.Unlock()

	// Start the new process
	if err := newManager.Start(ctx, modelPath, modelID); err != nil {
		s.mu.Lock()
		s.pending = nil
		s.mu.Unlock()

		return &SwitchResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	// Swap atomically
	s.mu.Lock()
	oldManager := s.current
	s.current = newManager
	s.pending = nil
	s.mu.Unlock()

	// Stop old process in background (don't block the switch)
	if oldManager != nil {
		go func() {
			s.logger.Info("stopping old process", "port", oldManager.Port())
			if err := oldManager.Stop(); err != nil {
				s.logger.Warn("failed to stop old process", "error", err)
			}
		}()
	}

	s.logger.Info("model switch completed successfully",
		"model_id", modelID,
		"port", newManager.Port(),
	)

	return &SwitchResult{
		Success:     true,
		ModelID:     modelID,
		ProfileName: profileName,
		Port:        newManager.Port(),
	}, nil
}

// Stop stops the current process.
func (s *Switcher) Stop() error {
	s.mu.Lock()
	current := s.current
	s.current = nil
	pending := s.pending
	s.pending = nil
	s.mu.Unlock()

	var lastErr error

	if pending != nil {
		if err := pending.Kill(); err != nil {
			lastErr = err
		}
	}

	if current != nil {
		if err := current.Stop(); err != nil {
			lastErr = err
		}
	}

	return lastErr
}

// Current returns the currently active process manager.
func (s *Switcher) Current() *Manager {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current
}

// IsSwitching returns true if a model switch is in progress.
func (s *Switcher) IsSwitching() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pending != nil
}

// HasActiveModel returns true if there's an active model loaded.
func (s *Switcher) HasActiveModel() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current != nil && s.current.IsRunning()
}

// ActiveModelID returns the ID of the currently active model.
func (s *Switcher) ActiveModelID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil {
		return ""
	}
	return s.current.ModelID()
}

// ActiveProfileName returns the name of the currently active profile.
func (s *Switcher) ActiveProfileName() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil {
		return ""
	}
	return s.current.ProfileName()
}

// UpstreamPort returns the port of the currently active llama-server.
func (s *Switcher) UpstreamPort() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil {
		return 0
	}
	return s.current.Port()
}

// UpstreamURL returns the URL of the currently active llama-server.
func (s *Switcher) UpstreamURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil {
		return ""
	}
	return s.current.BaseURL()
}

// Status returns the combined status for the switcher.
type SwitcherStatus struct {
	State         string   `json:"state"`
	ModelID       string   `json:"model_id,omitempty"`
	ProfileName   string   `json:"profile,omitempty"`
	UpstreamPort  int      `json:"upstream_port,omitempty"`
	Uptime        string   `json:"uptime,omitempty"`
	IsSwitching   bool     `json:"is_switching"`
	ProcessStatus *Status  `json:"process,omitempty"`
}

func (s *Switcher) Status() *SwitcherStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := &SwitcherStatus{
		IsSwitching: s.pending != nil,
	}

	if s.current == nil {
		status.State = "idle"
		return status
	}

	status.State = s.current.GetState().String()
	status.ModelID = s.current.ModelID()
	status.ProfileName = s.current.ProfileName()
	status.UpstreamPort = s.current.Port()
	status.Uptime = s.current.Uptime().String()
	status.ProcessStatus = s.current.Status()

	return status
}
