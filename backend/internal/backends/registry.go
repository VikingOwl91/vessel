package backends

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

// Registry manages multiple LLM backend instances
type Registry struct {
	mu       sync.RWMutex
	backends map[BackendType]LLMBackend
	active   BackendType
}

// NewRegistry creates a new backend registry
func NewRegistry() *Registry {
	return &Registry{
		backends: make(map[BackendType]LLMBackend),
	}
}

// Register adds a backend to the registry
func (r *Registry) Register(backend LLMBackend) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	bt := backend.Type()
	if _, exists := r.backends[bt]; exists {
		return fmt.Errorf("backend %q already registered", bt)
	}

	r.backends[bt] = backend
	return nil
}

// Unregister removes a backend from the registry
func (r *Registry) Unregister(backendType BackendType) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.backends[backendType]; !exists {
		return fmt.Errorf("backend %q not registered", backendType)
	}

	delete(r.backends, backendType)

	// Clear active if it was the unregistered backend
	if r.active == backendType {
		r.active = ""
	}

	return nil
}

// Get retrieves a backend by type
func (r *Registry) Get(backendType BackendType) (LLMBackend, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	backend, ok := r.backends[backendType]
	return backend, ok
}

// SetActive sets the active backend
func (r *Registry) SetActive(backendType BackendType) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.backends[backendType]; !exists {
		return fmt.Errorf("backend %q not registered", backendType)
	}

	r.active = backendType
	return nil
}

// Active returns the currently active backend
func (r *Registry) Active() LLMBackend {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if r.active == "" {
		return nil
	}

	return r.backends[r.active]
}

// ActiveType returns the type of the currently active backend
func (r *Registry) ActiveType() BackendType {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.active
}

// Backends returns all registered backend types
func (r *Registry) Backends() []BackendType {
	r.mu.RLock()
	defer r.mu.RUnlock()

	types := make([]BackendType, 0, len(r.backends))
	for bt := range r.backends {
		types = append(types, bt)
	}
	return types
}

// AllInfo returns information about all registered backends
func (r *Registry) AllInfo(ctx context.Context) []BackendInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	infos := make([]BackendInfo, 0, len(r.backends))
	for _, backend := range r.backends {
		infos = append(infos, backend.Info(ctx))
	}
	return infos
}

// DiscoveryEndpoint represents a potential backend endpoint to probe
type DiscoveryEndpoint struct {
	Type    BackendType
	BaseURL string
}

// DiscoveryResult represents the result of probing an endpoint
type DiscoveryResult struct {
	Type      BackendType `json:"type"`
	BaseURL   string      `json:"baseUrl"`
	Available bool        `json:"available"`
	Version   string      `json:"version,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// Discover probes the given endpoints to find available backends
func (r *Registry) Discover(ctx context.Context, endpoints []DiscoveryEndpoint) []DiscoveryResult {
	results := make([]DiscoveryResult, len(endpoints))
	var wg sync.WaitGroup

	for i, endpoint := range endpoints {
		wg.Add(1)
		go func(idx int, ep DiscoveryEndpoint) {
			defer wg.Done()
			results[idx] = probeEndpoint(ctx, ep)
		}(i, endpoint)
	}

	wg.Wait()
	return results
}

// probeEndpoint checks if a backend is available at the given endpoint
func probeEndpoint(ctx context.Context, endpoint DiscoveryEndpoint) DiscoveryResult {
	result := DiscoveryResult{
		Type:    endpoint.Type,
		BaseURL: endpoint.BaseURL,
	}

	client := &http.Client{
		Timeout: 3 * time.Second,
	}

	// Determine probe path based on backend type
	var probePath string
	switch endpoint.Type {
	case BackendTypeOllama:
		probePath = "/api/version"
	case BackendTypeLlamaCpp, BackendTypeLMStudio:
		probePath = "/v1/models"
	default:
		probePath = "/health"
	}

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint.BaseURL+probePath, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}

	resp, err := client.Do(req)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		result.Available = true
	} else {
		result.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	return result
}

// getEnvOrDefault returns the environment variable value or a default
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// DefaultDiscoveryEndpoints returns the default endpoints to probe.
// URLs can be overridden via environment variables (useful for Docker).
func DefaultDiscoveryEndpoints() []DiscoveryEndpoint {
	ollamaURL := getEnvOrDefault("OLLAMA_URL", "http://localhost:11434")
	llamacppURL := getEnvOrDefault("LLAMACPP_URL", "http://localhost:8081")
	lmstudioURL := getEnvOrDefault("LMSTUDIO_URL", "http://localhost:1234")

	return []DiscoveryEndpoint{
		{Type: BackendTypeOllama, BaseURL: ollamaURL},
		{Type: BackendTypeLlamaCpp, BaseURL: llamacppURL},
		{Type: BackendTypeLMStudio, BaseURL: lmstudioURL},
	}
}

// DiscoverAndRegister probes endpoints and registers available backends
func (r *Registry) DiscoverAndRegister(ctx context.Context, endpoints []DiscoveryEndpoint, adapterFactory AdapterFactory) []DiscoveryResult {
	results := r.Discover(ctx, endpoints)

	for _, result := range results {
		if !result.Available {
			continue
		}

		// Skip if already registered
		if _, exists := r.Get(result.Type); exists {
			continue
		}

		config := BackendConfig{
			Type:    result.Type,
			BaseURL: result.BaseURL,
			Enabled: true,
		}

		adapter, err := adapterFactory(config)
		if err != nil {
			continue
		}

		r.Register(adapter)
	}

	return results
}

// AdapterFactory creates an LLMBackend from a config
type AdapterFactory func(config BackendConfig) (LLMBackend, error)
