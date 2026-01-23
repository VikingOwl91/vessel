package ollama

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"vessel-backend/internal/backends"
)

func TestAdapter_Type(t *testing.T) {
	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: "http://localhost:11434",
	})

	if adapter.Type() != backends.BackendTypeOllama {
		t.Errorf("Type() = %v, want %v", adapter.Type(), backends.BackendTypeOllama)
	}
}

func TestAdapter_Config(t *testing.T) {
	cfg := backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: "http://localhost:11434",
		Enabled: true,
	}

	adapter, _ := NewAdapter(cfg)
	got := adapter.Config()

	if got.Type != cfg.Type {
		t.Errorf("Config().Type = %v, want %v", got.Type, cfg.Type)
	}
	if got.BaseURL != cfg.BaseURL {
		t.Errorf("Config().BaseURL = %v, want %v", got.BaseURL, cfg.BaseURL)
	}
}

func TestAdapter_Capabilities(t *testing.T) {
	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: "http://localhost:11434",
	})

	caps := adapter.Capabilities()

	if !caps.CanListModels {
		t.Error("Ollama adapter should support listing models")
	}
	if !caps.CanPullModels {
		t.Error("Ollama adapter should support pulling models")
	}
	if !caps.CanDeleteModels {
		t.Error("Ollama adapter should support deleting models")
	}
	if !caps.CanCreateModels {
		t.Error("Ollama adapter should support creating models")
	}
	if !caps.CanStreamChat {
		t.Error("Ollama adapter should support streaming chat")
	}
	if !caps.CanEmbed {
		t.Error("Ollama adapter should support embeddings")
	}
}

func TestAdapter_HealthCheck(t *testing.T) {
	t.Run("healthy server", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" || r.URL.Path == "/api/version" {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]string{"version": "0.1.0"})
			}
		}))
		defer server.Close()

		adapter, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})
		if err != nil {
			t.Fatalf("Failed to create adapter: %v", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := adapter.HealthCheck(ctx); err != nil {
			t.Errorf("HealthCheck() error = %v, want nil", err)
		}
	})

	t.Run("unreachable server", func(t *testing.T) {
		adapter, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:19999", // unlikely to be running
		})
		if err != nil {
			t.Fatalf("Failed to create adapter: %v", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()

		if err := adapter.HealthCheck(ctx); err == nil {
			t.Error("HealthCheck() expected error for unreachable server")
		}
	})
}

func TestAdapter_ListModels(t *testing.T) {
	t.Run("returns model list", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/tags" {
				resp := map[string]interface{}{
					"models": []map[string]interface{}{
						{
							"name":        "llama3.2:8b",
							"size":        int64(4700000000),
							"modified_at": "2024-01-15T10:30:00Z",
							"details": map[string]interface{}{
								"family":             "llama",
								"quantization_level": "Q4_K_M",
							},
						},
						{
							"name":        "mistral:7b",
							"size":        int64(4100000000),
							"modified_at": "2024-01-14T08:00:00Z",
							"details": map[string]interface{}{
								"family":             "mistral",
								"quantization_level": "Q4_0",
							},
						},
					},
				}
				json.NewEncoder(w).Encode(resp)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})

		ctx := context.Background()
		models, err := adapter.ListModels(ctx)
		if err != nil {
			t.Fatalf("ListModels() error = %v", err)
		}

		if len(models) != 2 {
			t.Errorf("ListModels() returned %d models, want 2", len(models))
		}

		if models[0].Name != "llama3.2:8b" {
			t.Errorf("First model name = %q, want %q", models[0].Name, "llama3.2:8b")
		}

		if models[0].Family != "llama" {
			t.Errorf("First model family = %q, want %q", models[0].Family, "llama")
		}
	})

	t.Run("handles empty model list", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/tags" {
				resp := map[string]interface{}{
					"models": []map[string]interface{}{},
				}
				json.NewEncoder(w).Encode(resp)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})

		models, err := adapter.ListModels(context.Background())
		if err != nil {
			t.Fatalf("ListModels() error = %v", err)
		}

		if len(models) != 0 {
			t.Errorf("ListModels() returned %d models, want 0", len(models))
		}
	})
}

func TestAdapter_Chat(t *testing.T) {
	t.Run("non-streaming chat", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/chat" && r.Method == "POST" {
				var req map[string]interface{}
				json.NewDecoder(r.Body).Decode(&req)

				// Check stream is false
				if stream, ok := req["stream"].(bool); !ok || stream {
					t.Error("Expected stream=false for non-streaming chat")
				}

				resp := map[string]interface{}{
					"model":   "llama3.2:8b",
					"message": map[string]interface{}{"role": "assistant", "content": "Hello! How can I help you?"},
					"done":    true,
				}
				json.NewEncoder(w).Encode(resp)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})

		req := &backends.ChatRequest{
			Model: "llama3.2:8b",
			Messages: []backends.ChatMessage{
				{Role: "user", Content: "Hello"},
			},
		}

		resp, err := adapter.Chat(context.Background(), req)
		if err != nil {
			t.Fatalf("Chat() error = %v", err)
		}

		if !resp.Done {
			t.Error("Chat() response.Done = false, want true")
		}

		if resp.Message == nil || resp.Message.Content != "Hello! How can I help you?" {
			t.Errorf("Chat() response content unexpected: %+v", resp.Message)
		}
	})
}

func TestAdapter_StreamChat(t *testing.T) {
	t.Run("streaming chat", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/chat" && r.Method == "POST" {
				var req map[string]interface{}
				json.NewDecoder(r.Body).Decode(&req)

				// Check stream is true
				if stream, ok := req["stream"].(bool); ok && !stream {
					t.Error("Expected stream=true for streaming chat")
				}

				w.Header().Set("Content-Type", "application/x-ndjson")
				flusher := w.(http.Flusher)

				// Send streaming chunks
				chunks := []map[string]interface{}{
					{"model": "llama3.2:8b", "message": map[string]interface{}{"role": "assistant", "content": "Hello"}, "done": false},
					{"model": "llama3.2:8b", "message": map[string]interface{}{"role": "assistant", "content": "!"}, "done": false},
					{"model": "llama3.2:8b", "message": map[string]interface{}{"role": "assistant", "content": ""}, "done": true},
				}

				for _, chunk := range chunks {
					data, _ := json.Marshal(chunk)
					w.Write(append(data, '\n'))
					flusher.Flush()
				}
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})

		streaming := true
		req := &backends.ChatRequest{
			Model: "llama3.2:8b",
			Messages: []backends.ChatMessage{
				{Role: "user", Content: "Hello"},
			},
			Stream: &streaming,
		}

		chunkCh, err := adapter.StreamChat(context.Background(), req)
		if err != nil {
			t.Fatalf("StreamChat() error = %v", err)
		}

		var chunks []backends.ChatChunk
		for chunk := range chunkCh {
			chunks = append(chunks, chunk)
		}

		if len(chunks) != 3 {
			t.Errorf("StreamChat() received %d chunks, want 3", len(chunks))
		}

		// Last chunk should be done
		if !chunks[len(chunks)-1].Done {
			t.Error("Last chunk should have Done=true")
		}
	})

	t.Run("handles context cancellation", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/chat" {
				w.Header().Set("Content-Type", "application/x-ndjson")
				flusher := w.(http.Flusher)

				// Send first chunk then wait
				chunk := map[string]interface{}{"model": "llama3.2:8b", "message": map[string]interface{}{"role": "assistant", "content": "Starting..."}, "done": false}
				data, _ := json.Marshal(chunk)
				w.Write(append(data, '\n'))
				flusher.Flush()

				// Wait long enough for context to be cancelled
				time.Sleep(2 * time.Second)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()

		streaming := true
		req := &backends.ChatRequest{
			Model: "llama3.2:8b",
			Messages: []backends.ChatMessage{
				{Role: "user", Content: "Hello"},
			},
			Stream: &streaming,
		}

		chunkCh, err := adapter.StreamChat(ctx, req)
		if err != nil {
			t.Fatalf("StreamChat() error = %v", err)
		}

		// Should receive at least one chunk before timeout
		receivedChunks := 0
		for range chunkCh {
			receivedChunks++
		}

		if receivedChunks == 0 {
			t.Error("Expected to receive at least one chunk before cancellation")
		}
	})
}

func TestAdapter_Info(t *testing.T) {
	t.Run("connected server", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" || r.URL.Path == "/api/version" {
				json.NewEncoder(w).Encode(map[string]string{"version": "0.3.0"})
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: server.URL,
		})

		info := adapter.Info(context.Background())

		if info.Type != backends.BackendTypeOllama {
			t.Errorf("Info().Type = %v, want %v", info.Type, backends.BackendTypeOllama)
		}

		if info.Status != backends.BackendStatusConnected {
			t.Errorf("Info().Status = %v, want %v", info.Status, backends.BackendStatusConnected)
		}

		if info.Version != "0.3.0" {
			t.Errorf("Info().Version = %v, want %v", info.Version, "0.3.0")
		}
	})

	t.Run("disconnected server", func(t *testing.T) {
		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:19999",
		})

		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()

		info := adapter.Info(ctx)

		if info.Status != backends.BackendStatusDisconnected {
			t.Errorf("Info().Status = %v, want %v", info.Status, backends.BackendStatusDisconnected)
		}

		if info.Error == "" {
			t.Error("Info().Error should be set for disconnected server")
		}
	})
}

func TestAdapter_ShowModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/show" && r.Method == "POST" {
			var req map[string]string
			json.NewDecoder(r.Body).Decode(&req)

			resp := map[string]interface{}{
				"modelfile": "FROM llama3.2:8b\nSYSTEM You are helpful.",
				"template":  "{{ .Prompt }}",
				"system":    "You are helpful.",
				"details": map[string]interface{}{
					"family":             "llama",
					"parameter_size":     "8B",
					"quantization_level": "Q4_K_M",
				},
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: server.URL,
	})

	details, err := adapter.ShowModel(context.Background(), "llama3.2:8b")
	if err != nil {
		t.Fatalf("ShowModel() error = %v", err)
	}

	if details.Family != "llama" {
		t.Errorf("ShowModel().Family = %q, want %q", details.Family, "llama")
	}

	if details.System != "You are helpful." {
		t.Errorf("ShowModel().System = %q, want %q", details.System, "You are helpful.")
	}
}

func TestAdapter_DeleteModel(t *testing.T) {
	deleted := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/delete" && r.Method == "DELETE" {
			deleted = true
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()

	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: server.URL,
	})

	err := adapter.DeleteModel(context.Background(), "test-model")
	if err != nil {
		t.Fatalf("DeleteModel() error = %v", err)
	}

	if !deleted {
		t.Error("DeleteModel() did not call the delete endpoint")
	}
}

func TestAdapter_CopyModel(t *testing.T) {
	copied := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/copy" && r.Method == "POST" {
			var req map[string]string
			json.NewDecoder(r.Body).Decode(&req)

			if req["source"] == "source-model" && req["destination"] == "dest-model" {
				copied = true
			}
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()

	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: server.URL,
	})

	err := adapter.CopyModel(context.Background(), "source-model", "dest-model")
	if err != nil {
		t.Fatalf("CopyModel() error = %v", err)
	}

	if !copied {
		t.Error("CopyModel() did not call the copy endpoint with correct params")
	}
}

func TestAdapter_Embed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/embed" && r.Method == "POST" {
			resp := map[string]interface{}{
				"embeddings": [][]float64{
					{0.1, 0.2, 0.3},
					{0.4, 0.5, 0.6},
				},
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: server.URL,
	})

	embeddings, err := adapter.Embed(context.Background(), "nomic-embed-text", []string{"hello", "world"})
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}

	if len(embeddings) != 2 {
		t.Errorf("Embed() returned %d embeddings, want 2", len(embeddings))
	}

	if len(embeddings[0]) != 3 {
		t.Errorf("First embedding has %d dimensions, want 3", len(embeddings[0]))
	}
}

func TestNewAdapter_Validation(t *testing.T) {
	t.Run("invalid URL", func(t *testing.T) {
		_, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "not-a-url",
		})
		if err == nil {
			t.Error("NewAdapter() should fail with invalid URL")
		}
	})

	t.Run("wrong backend type", func(t *testing.T) {
		_, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: "http://localhost:11434",
		})
		if err == nil {
			t.Error("NewAdapter() should fail with wrong backend type")
		}
	})

	t.Run("valid config", func(t *testing.T) {
		adapter, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:11434",
		})
		if err != nil {
			t.Errorf("NewAdapter() error = %v", err)
		}
		if adapter == nil {
			t.Error("NewAdapter() returned nil adapter")
		}
	})
}
