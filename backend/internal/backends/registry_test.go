package backends

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewRegistry(t *testing.T) {
	registry := NewRegistry()

	if registry == nil {
		t.Fatal("NewRegistry() returned nil")
	}

	if len(registry.Backends()) != 0 {
		t.Errorf("New registry should have no backends, got %d", len(registry.Backends()))
	}

	if registry.Active() != nil {
		t.Error("New registry should have no active backend")
	}
}

func TestRegistry_Register(t *testing.T) {
	registry := NewRegistry()

	// Create a mock backend
	mock := &mockBackend{
		backendType: BackendTypeOllama,
		config: BackendConfig{
			Type:    BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
	}

	err := registry.Register(mock)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	if len(registry.Backends()) != 1 {
		t.Errorf("Registry should have 1 backend, got %d", len(registry.Backends()))
	}

	// Should not allow duplicate registration
	err = registry.Register(mock)
	if err == nil {
		t.Error("Register() should fail for duplicate backend type")
	}
}

func TestRegistry_Get(t *testing.T) {
	registry := NewRegistry()

	mock := &mockBackend{
		backendType: BackendTypeOllama,
		config: BackendConfig{
			Type:    BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
	}
	registry.Register(mock)

	t.Run("existing backend", func(t *testing.T) {
		backend, ok := registry.Get(BackendTypeOllama)
		if !ok {
			t.Error("Get() should return ok=true for registered backend")
		}
		if backend != mock {
			t.Error("Get() returned wrong backend")
		}
	})

	t.Run("non-existing backend", func(t *testing.T) {
		_, ok := registry.Get(BackendTypeLlamaCpp)
		if ok {
			t.Error("Get() should return ok=false for unregistered backend")
		}
	})
}

func TestRegistry_SetActive(t *testing.T) {
	registry := NewRegistry()

	mock := &mockBackend{
		backendType: BackendTypeOllama,
		config: BackendConfig{
			Type:    BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
	}
	registry.Register(mock)

	t.Run("set registered backend as active", func(t *testing.T) {
		err := registry.SetActive(BackendTypeOllama)
		if err != nil {
			t.Errorf("SetActive() error = %v", err)
		}

		active := registry.Active()
		if active == nil {
			t.Fatal("Active() returned nil after SetActive()")
		}
		if active.Type() != BackendTypeOllama {
			t.Errorf("Active().Type() = %v, want %v", active.Type(), BackendTypeOllama)
		}
	})

	t.Run("set unregistered backend as active", func(t *testing.T) {
		err := registry.SetActive(BackendTypeLlamaCpp)
		if err == nil {
			t.Error("SetActive() should fail for unregistered backend")
		}
	})
}

func TestRegistry_ActiveType(t *testing.T) {
	registry := NewRegistry()

	t.Run("no active backend", func(t *testing.T) {
		activeType := registry.ActiveType()
		if activeType != "" {
			t.Errorf("ActiveType() = %q, want empty string", activeType)
		}
	})

	t.Run("with active backend", func(t *testing.T) {
		mock := &mockBackend{backendType: BackendTypeOllama}
		registry.Register(mock)
		registry.SetActive(BackendTypeOllama)

		activeType := registry.ActiveType()
		if activeType != BackendTypeOllama {
			t.Errorf("ActiveType() = %v, want %v", activeType, BackendTypeOllama)
		}
	})
}

func TestRegistry_Unregister(t *testing.T) {
	registry := NewRegistry()

	mock := &mockBackend{backendType: BackendTypeOllama}
	registry.Register(mock)
	registry.SetActive(BackendTypeOllama)

	err := registry.Unregister(BackendTypeOllama)
	if err != nil {
		t.Errorf("Unregister() error = %v", err)
	}

	if len(registry.Backends()) != 0 {
		t.Error("Registry should have no backends after unregister")
	}

	if registry.Active() != nil {
		t.Error("Active backend should be nil after unregistering it")
	}
}

func TestRegistry_AllInfo(t *testing.T) {
	registry := NewRegistry()

	mock1 := &mockBackend{
		backendType: BackendTypeOllama,
		config:      BackendConfig{Type: BackendTypeOllama, BaseURL: "http://localhost:11434"},
		info: BackendInfo{
			Type:    BackendTypeOllama,
			Status:  BackendStatusConnected,
			Version: "0.1.0",
		},
	}
	mock2 := &mockBackend{
		backendType: BackendTypeLlamaCpp,
		config:      BackendConfig{Type: BackendTypeLlamaCpp, BaseURL: "http://localhost:8081"},
		info: BackendInfo{
			Type:   BackendTypeLlamaCpp,
			Status: BackendStatusDisconnected,
		},
	}

	registry.Register(mock1)
	registry.Register(mock2)
	registry.SetActive(BackendTypeOllama)

	infos := registry.AllInfo(context.Background())

	if len(infos) != 2 {
		t.Errorf("AllInfo() returned %d infos, want 2", len(infos))
	}

	// Find the active one
	var foundActive bool
	for _, info := range infos {
		if info.Type == BackendTypeOllama {
			foundActive = true
		}
	}
	if !foundActive {
		t.Error("AllInfo() did not include ollama backend info")
	}
}

func TestRegistry_Discover(t *testing.T) {
	// Create test servers for each backend type
	ollamaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/version" || r.URL.Path == "/" {
			json.NewEncoder(w).Encode(map[string]string{"version": "0.3.0"})
		}
	}))
	defer ollamaServer.Close()

	llamacppServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"data": []map[string]string{{"id": "llama3.2:8b"}},
			})
		}
		if r.URL.Path == "/health" {
			json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		}
	}))
	defer llamacppServer.Close()

	registry := NewRegistry()

	// Configure discovery endpoints
	endpoints := []DiscoveryEndpoint{
		{Type: BackendTypeOllama, BaseURL: ollamaServer.URL},
		{Type: BackendTypeLlamaCpp, BaseURL: llamacppServer.URL},
		{Type: BackendTypeLMStudio, BaseURL: "http://localhost:19999"}, // Not running
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	results := registry.Discover(ctx, endpoints)

	if len(results) != 3 {
		t.Errorf("Discover() returned %d results, want 3", len(results))
	}

	// Check Ollama was discovered
	var ollamaResult *DiscoveryResult
	for i := range results {
		if results[i].Type == BackendTypeOllama {
			ollamaResult = &results[i]
			break
		}
	}

	if ollamaResult == nil {
		t.Fatal("Ollama not found in discovery results")
	}
	if !ollamaResult.Available {
		t.Errorf("Ollama should be available, error: %s", ollamaResult.Error)
	}

	// Check LM Studio was not discovered
	var lmstudioResult *DiscoveryResult
	for i := range results {
		if results[i].Type == BackendTypeLMStudio {
			lmstudioResult = &results[i]
			break
		}
	}

	if lmstudioResult == nil {
		t.Fatal("LM Studio not found in discovery results")
	}
	if lmstudioResult.Available {
		t.Error("LM Studio should NOT be available")
	}
}

func TestRegistry_DefaultEndpoints(t *testing.T) {
	endpoints := DefaultDiscoveryEndpoints()

	if len(endpoints) < 3 {
		t.Errorf("DefaultDiscoveryEndpoints() returned %d endpoints, want at least 3", len(endpoints))
	}

	// Check that all expected types are present
	types := make(map[BackendType]bool)
	for _, e := range endpoints {
		types[e.Type] = true
	}

	if !types[BackendTypeOllama] {
		t.Error("DefaultDiscoveryEndpoints() missing Ollama")
	}
	if !types[BackendTypeLlamaCpp] {
		t.Error("DefaultDiscoveryEndpoints() missing llama.cpp")
	}
	if !types[BackendTypeLMStudio] {
		t.Error("DefaultDiscoveryEndpoints() missing LM Studio")
	}
}

// mockBackend implements LLMBackend for testing
type mockBackend struct {
	backendType BackendType
	config      BackendConfig
	info        BackendInfo
	healthErr   error
	models      []Model
}

func (m *mockBackend) Type() BackendType {
	return m.backendType
}

func (m *mockBackend) Config() BackendConfig {
	return m.config
}

func (m *mockBackend) HealthCheck(ctx context.Context) error {
	return m.healthErr
}

func (m *mockBackend) ListModels(ctx context.Context) ([]Model, error) {
	return m.models, nil
}

func (m *mockBackend) StreamChat(ctx context.Context, req *ChatRequest) (<-chan ChatChunk, error) {
	ch := make(chan ChatChunk)
	close(ch)
	return ch, nil
}

func (m *mockBackend) Chat(ctx context.Context, req *ChatRequest) (*ChatChunk, error) {
	return &ChatChunk{Done: true}, nil
}

func (m *mockBackend) Capabilities() BackendCapabilities {
	return OllamaCapabilities()
}

func (m *mockBackend) Info(ctx context.Context) BackendInfo {
	if m.info.Type != "" {
		return m.info
	}
	return BackendInfo{
		Type:         m.backendType,
		BaseURL:      m.config.BaseURL,
		Status:       BackendStatusConnected,
		Capabilities: m.Capabilities(),
	}
}
