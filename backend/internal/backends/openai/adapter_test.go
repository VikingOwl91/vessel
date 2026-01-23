package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"vessel-backend/internal/backends"
)

func TestAdapter_Type(t *testing.T) {
	tests := []struct {
		name         string
		backendType  backends.BackendType
		expectedType backends.BackendType
	}{
		{"llamacpp type", backends.BackendTypeLlamaCpp, backends.BackendTypeLlamaCpp},
		{"lmstudio type", backends.BackendTypeLMStudio, backends.BackendTypeLMStudio},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, _ := NewAdapter(backends.BackendConfig{
				Type:    tt.backendType,
				BaseURL: "http://localhost:8081",
			})

			if adapter.Type() != tt.expectedType {
				t.Errorf("Type() = %v, want %v", adapter.Type(), tt.expectedType)
			}
		})
	}
}

func TestAdapter_Config(t *testing.T) {
	cfg := backends.BackendConfig{
		Type:    backends.BackendTypeLlamaCpp,
		BaseURL: "http://localhost:8081",
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
	t.Run("llamacpp capabilities", func(t *testing.T) {
		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: "http://localhost:8081",
		})

		caps := adapter.Capabilities()

		if !caps.CanListModels {
			t.Error("llama.cpp adapter should support listing models")
		}
		if caps.CanPullModels {
			t.Error("llama.cpp adapter should NOT support pulling models")
		}
		if caps.CanDeleteModels {
			t.Error("llama.cpp adapter should NOT support deleting models")
		}
		if caps.CanCreateModels {
			t.Error("llama.cpp adapter should NOT support creating models")
		}
		if !caps.CanStreamChat {
			t.Error("llama.cpp adapter should support streaming chat")
		}
		if !caps.CanEmbed {
			t.Error("llama.cpp adapter should support embeddings")
		}
	})

	t.Run("lmstudio capabilities", func(t *testing.T) {
		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLMStudio,
			BaseURL: "http://localhost:1234",
		})

		caps := adapter.Capabilities()

		if !caps.CanListModels {
			t.Error("LM Studio adapter should support listing models")
		}
		if caps.CanPullModels {
			t.Error("LM Studio adapter should NOT support pulling models")
		}
	})
}

func TestAdapter_HealthCheck(t *testing.T) {
	t.Run("healthy server", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/models" {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"data": []map[string]string{{"id": "llama3.2:8b"}},
				})
			}
		}))
		defer server.Close()

		adapter, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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
		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: "http://localhost:19999",
		})

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
			if r.URL.Path == "/v1/models" {
				resp := map[string]interface{}{
					"data": []map[string]interface{}{
						{
							"id":       "llama3.2-8b-instruct",
							"object":   "model",
							"owned_by": "local",
							"created":  1700000000,
						},
						{
							"id":       "mistral-7b-v0.2",
							"object":   "model",
							"owned_by": "local",
							"created":  1700000001,
						},
					},
				}
				json.NewEncoder(w).Encode(resp)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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

		if models[0].ID != "llama3.2-8b-instruct" {
			t.Errorf("First model ID = %q, want %q", models[0].ID, "llama3.2-8b-instruct")
		}
	})

	t.Run("handles empty model list", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/models" {
				resp := map[string]interface{}{
					"data": []map[string]interface{}{},
				}
				json.NewEncoder(w).Encode(resp)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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
			if r.URL.Path == "/v1/chat/completions" && r.Method == "POST" {
				var req map[string]interface{}
				json.NewDecoder(r.Body).Decode(&req)

				// Check stream is false
				if stream, ok := req["stream"].(bool); ok && stream {
					t.Error("Expected stream=false for non-streaming chat")
				}

				resp := map[string]interface{}{
					"id":      "chatcmpl-123",
					"object":  "chat.completion",
					"created": 1700000000,
					"model":   "llama3.2:8b",
					"choices": []map[string]interface{}{
						{
							"index": 0,
							"message": map[string]interface{}{
								"role":    "assistant",
								"content": "Hello! How can I help you?",
							},
							"finish_reason": "stop",
						},
					},
					"usage": map[string]int{
						"prompt_tokens":     10,
						"completion_tokens": 8,
						"total_tokens":      18,
					},
				}
				json.NewEncoder(w).Encode(resp)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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
	t.Run("streaming chat with SSE", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/chat/completions" && r.Method == "POST" {
				var req map[string]interface{}
				json.NewDecoder(r.Body).Decode(&req)

				// Check stream is true
				if stream, ok := req["stream"].(bool); !ok || !stream {
					t.Error("Expected stream=true for streaming chat")
				}

				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("Cache-Control", "no-cache")
				flusher := w.(http.Flusher)

				// Send SSE chunks
				chunks := []string{
					`{"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":"Hello"}}]}`,
					`{"id":"chatcmpl-1","choices":[{"delta":{"content":"!"}}]}`,
					`{"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}]}`,
				}

				for _, chunk := range chunks {
					fmt.Fprintf(w, "data: %s\n\n", chunk)
					flusher.Flush()
				}
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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

		if len(chunks) < 2 {
			t.Errorf("StreamChat() received %d chunks, want at least 2", len(chunks))
		}

		// Last chunk should be done
		if !chunks[len(chunks)-1].Done {
			t.Error("Last chunk should have Done=true")
		}
	})

	t.Run("handles context cancellation", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/chat/completions" {
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)

				// Send first chunk then wait
				fmt.Fprintf(w, "data: %s\n\n", `{"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":"Starting..."}}]}`)
				flusher.Flush()

				// Wait long enough for context to be cancelled
				time.Sleep(2 * time.Second)
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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
			if r.URL.Path == "/v1/models" {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"data": []map[string]string{{"id": "llama3.2:8b"}},
				})
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: server.URL,
		})

		info := adapter.Info(context.Background())

		if info.Type != backends.BackendTypeLlamaCpp {
			t.Errorf("Info().Type = %v, want %v", info.Type, backends.BackendTypeLlamaCpp)
		}

		if info.Status != backends.BackendStatusConnected {
			t.Errorf("Info().Status = %v, want %v", info.Status, backends.BackendStatusConnected)
		}
	})

	t.Run("disconnected server", func(t *testing.T) {
		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
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

func TestAdapter_Embed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/embeddings" && r.Method == "POST" {
			resp := map[string]interface{}{
				"data": []map[string]interface{}{
					{"embedding": []float64{0.1, 0.2, 0.3}, "index": 0},
					{"embedding": []float64{0.4, 0.5, 0.6}, "index": 1},
				},
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	adapter, _ := NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeLlamaCpp,
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
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: "not-a-url",
		})
		if err == nil {
			t.Error("NewAdapter() should fail with invalid URL")
		}
	})

	t.Run("wrong backend type", func(t *testing.T) {
		_, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeOllama,
			BaseURL: "http://localhost:8081",
		})
		if err == nil {
			t.Error("NewAdapter() should fail with Ollama backend type")
		}
	})

	t.Run("valid llamacpp config", func(t *testing.T) {
		adapter, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: "http://localhost:8081",
		})
		if err != nil {
			t.Errorf("NewAdapter() error = %v", err)
		}
		if adapter == nil {
			t.Error("NewAdapter() returned nil adapter")
		}
	})

	t.Run("valid lmstudio config", func(t *testing.T) {
		adapter, err := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLMStudio,
			BaseURL: "http://localhost:1234",
		})
		if err != nil {
			t.Errorf("NewAdapter() error = %v", err)
		}
		if adapter == nil {
			t.Error("NewAdapter() returned nil adapter")
		}
	})
}

func TestAdapter_ToolCalls(t *testing.T) {
	t.Run("streaming with tool calls", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/chat/completions" {
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)

				// Send tool call chunks
				chunks := []string{
					`{"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}`,
					`{"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"location\":"}}]}}]}`,
					`{"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Tokyo\"}"}}]}}]}`,
					`{"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
				}

				for _, chunk := range chunks {
					fmt.Fprintf(w, "data: %s\n\n", chunk)
					flusher.Flush()
				}
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
			}
		}))
		defer server.Close()

		adapter, _ := NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: server.URL,
		})

		streaming := true
		req := &backends.ChatRequest{
			Model: "llama3.2:8b",
			Messages: []backends.ChatMessage{
				{Role: "user", Content: "What's the weather in Tokyo?"},
			},
			Stream: &streaming,
			Tools: []backends.Tool{
				{
					Type: "function",
					Function: struct {
						Name        string                 `json:"name"`
						Description string                 `json:"description"`
						Parameters  map[string]interface{} `json:"parameters"`
					}{
						Name:        "get_weather",
						Description: "Get weather for a location",
					},
				},
			},
		}

		chunkCh, err := adapter.StreamChat(context.Background(), req)
		if err != nil {
			t.Fatalf("StreamChat() error = %v", err)
		}

		var lastChunk backends.ChatChunk
		for chunk := range chunkCh {
			lastChunk = chunk
		}

		if !lastChunk.Done {
			t.Error("Last chunk should have Done=true")
		}
	})
}
