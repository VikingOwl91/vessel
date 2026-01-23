package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"vessel-backend/internal/backends"
)

func setupAITestRouter(registry *backends.Registry) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	handlers := NewAIHandlers(registry)

	ai := r.Group("/api/v1/ai")
	{
		ai.GET("/backends", handlers.ListBackendsHandler())
		ai.POST("/backends/discover", handlers.DiscoverBackendsHandler())
		ai.POST("/backends/active", handlers.SetActiveHandler())
		ai.GET("/backends/:type/health", handlers.HealthCheckHandler())
		ai.POST("/chat", handlers.ChatHandler())
		ai.GET("/models", handlers.ListModelsHandler())
	}

	return r
}

func TestAIHandlers_ListBackends(t *testing.T) {
	registry := backends.NewRegistry()

	mock := &mockAIBackend{
		backendType: backends.BackendTypeOllama,
		config: backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
		info: backends.BackendInfo{
			Type:         backends.BackendTypeOllama,
			BaseURL:      "http://localhost:11434",
			Status:       backends.BackendStatusConnected,
			Capabilities: backends.OllamaCapabilities(),
			Version:      "0.3.0",
		},
	}
	registry.Register(mock)
	registry.SetActive(backends.BackendTypeOllama)

	router := setupAITestRouter(registry)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/ai/backends", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("ListBackends() status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp struct {
		Backends []backends.BackendInfo `json:"backends"`
		Active   string                 `json:"active"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if len(resp.Backends) != 1 {
		t.Errorf("ListBackends() returned %d backends, want 1", len(resp.Backends))
	}

	if resp.Active != "ollama" {
		t.Errorf("ListBackends() active = %q, want %q", resp.Active, "ollama")
	}
}

func TestAIHandlers_SetActive(t *testing.T) {
	registry := backends.NewRegistry()

	mock := &mockAIBackend{
		backendType: backends.BackendTypeOllama,
		config: backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
	}
	registry.Register(mock)

	router := setupAITestRouter(registry)

	t.Run("set valid backend active", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"type": "ollama"})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/ai/backends/active", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("SetActive() status = %d, want %d", w.Code, http.StatusOK)
		}

		if registry.ActiveType() != backends.BackendTypeOllama {
			t.Errorf("Active backend = %v, want %v", registry.ActiveType(), backends.BackendTypeOllama)
		}
	})

	t.Run("set invalid backend active", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"type": "llamacpp"})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/ai/backends/active", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("SetActive() status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})
}

func TestAIHandlers_HealthCheck(t *testing.T) {
	registry := backends.NewRegistry()

	mock := &mockAIBackend{
		backendType: backends.BackendTypeOllama,
		config: backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
		healthErr: nil,
	}
	registry.Register(mock)

	router := setupAITestRouter(registry)

	t.Run("healthy backend", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/api/v1/ai/backends/ollama/health", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("HealthCheck() status = %d, want %d", w.Code, http.StatusOK)
		}
	})

	t.Run("non-existent backend", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/api/v1/ai/backends/llamacpp/health", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("HealthCheck() status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})
}

func TestAIHandlers_ListModels(t *testing.T) {
	registry := backends.NewRegistry()

	mock := &mockAIBackend{
		backendType: backends.BackendTypeOllama,
		config: backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
		models: []backends.Model{
			{ID: "llama3.2:8b", Name: "llama3.2:8b", Family: "llama"},
			{ID: "mistral:7b", Name: "mistral:7b", Family: "mistral"},
		},
	}
	registry.Register(mock)
	registry.SetActive(backends.BackendTypeOllama)

	router := setupAITestRouter(registry)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/ai/models", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("ListModels() status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp struct {
		Models []backends.Model `json:"models"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if len(resp.Models) != 2 {
		t.Errorf("ListModels() returned %d models, want 2", len(resp.Models))
	}
}

func TestAIHandlers_ListModels_NoActiveBackend(t *testing.T) {
	registry := backends.NewRegistry()
	router := setupAITestRouter(registry)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/ai/models", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("ListModels() status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

func TestAIHandlers_Chat(t *testing.T) {
	registry := backends.NewRegistry()

	mock := &mockAIBackend{
		backendType: backends.BackendTypeOllama,
		config: backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		},
		chatResponse: &backends.ChatChunk{
			Model: "llama3.2:8b",
			Message: &backends.ChatMessage{
				Role:    "assistant",
				Content: "Hello! How can I help?",
			},
			Done: true,
		},
	}
	registry.Register(mock)
	registry.SetActive(backends.BackendTypeOllama)

	router := setupAITestRouter(registry)

	t.Run("non-streaming chat", func(t *testing.T) {
		chatReq := backends.ChatRequest{
			Model: "llama3.2:8b",
			Messages: []backends.ChatMessage{
				{Role: "user", Content: "Hello"},
			},
		}
		body, _ := json.Marshal(chatReq)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/ai/chat", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Chat() status = %d, want %d, body: %s", w.Code, http.StatusOK, w.Body.String())
		}

		var resp backends.ChatChunk
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		if !resp.Done {
			t.Error("Chat() response.Done = false, want true")
		}

		if resp.Message == nil || resp.Message.Content != "Hello! How can I help?" {
			t.Errorf("Chat() unexpected response: %+v", resp)
		}
	})
}

func TestAIHandlers_Chat_InvalidRequest(t *testing.T) {
	registry := backends.NewRegistry()

	mock := &mockAIBackend{
		backendType: backends.BackendTypeOllama,
	}
	registry.Register(mock)
	registry.SetActive(backends.BackendTypeOllama)

	router := setupAITestRouter(registry)

	// Missing model
	chatReq := map[string]interface{}{
		"messages": []map[string]string{
			{"role": "user", "content": "Hello"},
		},
	}
	body, _ := json.Marshal(chatReq)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/ai/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Chat() status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// mockAIBackend implements backends.LLMBackend for testing
type mockAIBackend struct {
	backendType  backends.BackendType
	config       backends.BackendConfig
	info         backends.BackendInfo
	healthErr    error
	models       []backends.Model
	chatResponse *backends.ChatChunk
}

func (m *mockAIBackend) Type() backends.BackendType {
	return m.backendType
}

func (m *mockAIBackend) Config() backends.BackendConfig {
	return m.config
}

func (m *mockAIBackend) HealthCheck(ctx context.Context) error {
	return m.healthErr
}

func (m *mockAIBackend) ListModels(ctx context.Context) ([]backends.Model, error) {
	return m.models, nil
}

func (m *mockAIBackend) StreamChat(ctx context.Context, req *backends.ChatRequest) (<-chan backends.ChatChunk, error) {
	ch := make(chan backends.ChatChunk, 1)
	if m.chatResponse != nil {
		ch <- *m.chatResponse
	}
	close(ch)
	return ch, nil
}

func (m *mockAIBackend) Chat(ctx context.Context, req *backends.ChatRequest) (*backends.ChatChunk, error) {
	if m.chatResponse != nil {
		return m.chatResponse, nil
	}
	return &backends.ChatChunk{Done: true}, nil
}

func (m *mockAIBackend) Capabilities() backends.BackendCapabilities {
	return backends.OllamaCapabilities()
}

func (m *mockAIBackend) Info(ctx context.Context) backends.BackendInfo {
	if m.info.Type != "" {
		return m.info
	}
	return backends.BackendInfo{
		Type:         m.backendType,
		BaseURL:      m.config.BaseURL,
		Status:       backends.BackendStatusConnected,
		Capabilities: m.Capabilities(),
	}
}
