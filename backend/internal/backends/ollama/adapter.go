package ollama

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"vessel-backend/internal/backends"
)

// Adapter implements the LLMBackend interface for Ollama.
// It also implements ModelManager and EmbeddingProvider.
type Adapter struct {
	config     backends.BackendConfig
	httpClient *http.Client
	baseURL    *url.URL
}

// Ensure Adapter implements all required interfaces
var (
	_ backends.LLMBackend         = (*Adapter)(nil)
	_ backends.ModelManager       = (*Adapter)(nil)
	_ backends.EmbeddingProvider  = (*Adapter)(nil)
)

// NewAdapter creates a new Ollama backend adapter
func NewAdapter(config backends.BackendConfig) (*Adapter, error) {
	if config.Type != backends.BackendTypeOllama {
		return nil, fmt.Errorf("invalid backend type: expected %s, got %s", backends.BackendTypeOllama, config.Type)
	}

	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	baseURL, err := url.Parse(config.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}

	return &Adapter{
		config:  config,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// Type returns the backend type
func (a *Adapter) Type() backends.BackendType {
	return backends.BackendTypeOllama
}

// Config returns the backend configuration
func (a *Adapter) Config() backends.BackendConfig {
	return a.config
}

// Capabilities returns what features this backend supports
func (a *Adapter) Capabilities() backends.BackendCapabilities {
	return backends.OllamaCapabilities()
}

// HealthCheck verifies the backend is reachable
func (a *Adapter) HealthCheck(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", a.baseURL.String()+"/api/version", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach Ollama: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Ollama returned status %d", resp.StatusCode)
	}

	return nil
}

// ollamaListResponse represents the response from /api/tags
type ollamaListResponse struct {
	Models []ollamaModel `json:"models"`
}

type ollamaModel struct {
	Name       string            `json:"name"`
	Size       int64             `json:"size"`
	ModifiedAt string            `json:"modified_at"`
	Details    ollamaModelDetails `json:"details"`
}

type ollamaModelDetails struct {
	Family     string `json:"family"`
	QuantLevel string `json:"quantization_level"`
	ParamSize  string `json:"parameter_size"`
}

// ListModels returns all models available from Ollama
func (a *Adapter) ListModels(ctx context.Context) ([]backends.Model, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", a.baseURL.String()+"/api/tags", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to list models: %w", err)
	}
	defer resp.Body.Close()

	var listResp ollamaListResponse
	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	models := make([]backends.Model, len(listResp.Models))
	for i, m := range listResp.Models {
		models[i] = backends.Model{
			ID:         m.Name,
			Name:       m.Name,
			Size:       m.Size,
			ModifiedAt: m.ModifiedAt,
			Family:     m.Details.Family,
			QuantLevel: m.Details.QuantLevel,
		}
	}

	return models, nil
}

// Chat sends a non-streaming chat request
func (a *Adapter) Chat(ctx context.Context, req *backends.ChatRequest) (*backends.ChatChunk, error) {
	if err := req.Validate(); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Convert to Ollama format
	ollamaReq := a.convertChatRequest(req)
	ollamaReq["stream"] = false

	body, err := json.Marshal(ollamaReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("chat request failed: %w", err)
	}
	defer resp.Body.Close()

	var ollamaResp ollamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return a.convertChatResponse(&ollamaResp), nil
}

// StreamChat sends a streaming chat request
func (a *Adapter) StreamChat(ctx context.Context, req *backends.ChatRequest) (<-chan backends.ChatChunk, error) {
	if err := req.Validate(); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Convert to Ollama format
	ollamaReq := a.convertChatRequest(req)
	ollamaReq["stream"] = true

	body, err := json.Marshal(ollamaReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create HTTP request without timeout for streaming
	httpReq, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	// Use a client without timeout for streaming
	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("chat request failed: %w", err)
	}

	chunkCh := make(chan backends.ChatChunk)

	go func() {
		defer close(chunkCh)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return
			default:
			}

			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}

			var ollamaResp ollamaChatResponse
			if err := json.Unmarshal(line, &ollamaResp); err != nil {
				chunkCh <- backends.ChatChunk{Error: fmt.Sprintf("failed to parse response: %v", err)}
				return
			}

			chunkCh <- *a.convertChatResponse(&ollamaResp)

			if ollamaResp.Done {
				return
			}
		}

		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			chunkCh <- backends.ChatChunk{Error: fmt.Sprintf("stream error: %v", err)}
		}
	}()

	return chunkCh, nil
}

// Info returns detailed information about the backend
func (a *Adapter) Info(ctx context.Context) backends.BackendInfo {
	info := backends.BackendInfo{
		Type:         backends.BackendTypeOllama,
		BaseURL:      a.config.BaseURL,
		Capabilities: a.Capabilities(),
	}

	// Try to get version
	req, err := http.NewRequestWithContext(ctx, "GET", a.baseURL.String()+"/api/version", nil)
	if err != nil {
		info.Status = backends.BackendStatusDisconnected
		info.Error = err.Error()
		return info
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		info.Status = backends.BackendStatusDisconnected
		info.Error = err.Error()
		return info
	}
	defer resp.Body.Close()

	var versionResp struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&versionResp); err != nil {
		info.Status = backends.BackendStatusDisconnected
		info.Error = err.Error()
		return info
	}

	info.Status = backends.BackendStatusConnected
	info.Version = versionResp.Version
	return info
}

// ShowModel returns detailed information about a specific model
func (a *Adapter) ShowModel(ctx context.Context, name string) (*backends.ModelDetails, error) {
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/show", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to show model: %w", err)
	}
	defer resp.Body.Close()

	var showResp struct {
		Modelfile string `json:"modelfile"`
		Template  string `json:"template"`
		System    string `json:"system"`
		Details   struct {
			Family     string `json:"family"`
			ParamSize  string `json:"parameter_size"`
			QuantLevel string `json:"quantization_level"`
		} `json:"details"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&showResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &backends.ModelDetails{
		Name:       name,
		Family:     showResp.Details.Family,
		ParamSize:  showResp.Details.ParamSize,
		QuantLevel: showResp.Details.QuantLevel,
		Template:   showResp.Template,
		System:     showResp.System,
		Modelfile:  showResp.Modelfile,
	}, nil
}

// PullModel downloads a model from the registry
func (a *Adapter) PullModel(ctx context.Context, name string) (<-chan backends.PullProgress, error) {
	body, err := json.Marshal(map[string]interface{}{"name": name, "stream": true})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/pull", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to pull model: %w", err)
	}

	progressCh := make(chan backends.PullProgress)

	go func() {
		defer close(progressCh)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return
			default:
			}

			var progress struct {
				Status    string `json:"status"`
				Digest    string `json:"digest"`
				Total     int64  `json:"total"`
				Completed int64  `json:"completed"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &progress); err != nil {
				progressCh <- backends.PullProgress{Error: err.Error()}
				return
			}

			progressCh <- backends.PullProgress{
				Status:    progress.Status,
				Digest:    progress.Digest,
				Total:     progress.Total,
				Completed: progress.Completed,
			}
		}

		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			progressCh <- backends.PullProgress{Error: err.Error()}
		}
	}()

	return progressCh, nil
}

// DeleteModel removes a model from local storage
func (a *Adapter) DeleteModel(ctx context.Context, name string) error {
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "DELETE", a.baseURL.String()+"/api/delete", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete model: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("delete failed: %s", string(bodyBytes))
	}

	return nil
}

// CreateModel creates a custom model with the given Modelfile content
func (a *Adapter) CreateModel(ctx context.Context, name string, modelfile string) (<-chan backends.CreateProgress, error) {
	body, err := json.Marshal(map[string]interface{}{
		"name":      name,
		"modelfile": modelfile,
		"stream":    true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/create", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to create model: %w", err)
	}

	progressCh := make(chan backends.CreateProgress)

	go func() {
		defer close(progressCh)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return
			default:
			}

			var progress struct {
				Status string `json:"status"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &progress); err != nil {
				progressCh <- backends.CreateProgress{Error: err.Error()}
				return
			}

			progressCh <- backends.CreateProgress{Status: progress.Status}
		}

		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			progressCh <- backends.CreateProgress{Error: err.Error()}
		}
	}()

	return progressCh, nil
}

// CopyModel creates a copy of an existing model
func (a *Adapter) CopyModel(ctx context.Context, source, destination string) error {
	body, err := json.Marshal(map[string]string{
		"source":      source,
		"destination": destination,
	})
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/copy", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to copy model: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("copy failed: %s", string(bodyBytes))
	}

	return nil
}

// Embed generates embeddings for the given input
func (a *Adapter) Embed(ctx context.Context, model string, input []string) ([][]float64, error) {
	body, err := json.Marshal(map[string]interface{}{
		"model": model,
		"input": input,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/api/embed", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embed request failed: %w", err)
	}
	defer resp.Body.Close()

	var embedResp struct {
		Embeddings [][]float64 `json:"embeddings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&embedResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return embedResp.Embeddings, nil
}

// ollamaChatResponse represents the response from /api/chat
type ollamaChatResponse struct {
	Model     string             `json:"model"`
	CreatedAt string             `json:"created_at"`
	Message   ollamaChatMessage  `json:"message"`
	Done      bool               `json:"done"`
	DoneReason string            `json:"done_reason,omitempty"`
	PromptEvalCount int          `json:"prompt_eval_count,omitempty"`
	EvalCount       int          `json:"eval_count,omitempty"`
}

type ollamaChatMessage struct {
	Role      string            `json:"role"`
	Content   string            `json:"content"`
	Images    []string          `json:"images,omitempty"`
	ToolCalls []ollamaToolCall  `json:"tool_calls,omitempty"`
}

type ollamaToolCall struct {
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

// convertChatRequest converts a backends.ChatRequest to Ollama format
func (a *Adapter) convertChatRequest(req *backends.ChatRequest) map[string]interface{} {
	messages := make([]map[string]interface{}, len(req.Messages))
	for i, msg := range req.Messages {
		m := map[string]interface{}{
			"role":    msg.Role,
			"content": msg.Content,
		}
		if len(msg.Images) > 0 {
			m["images"] = msg.Images
		}
		messages[i] = m
	}

	ollamaReq := map[string]interface{}{
		"model":    req.Model,
		"messages": messages,
	}

	// Add optional parameters
	if req.Options != nil {
		ollamaReq["options"] = req.Options
	}
	if len(req.Tools) > 0 {
		ollamaReq["tools"] = req.Tools
	}

	return ollamaReq
}

// convertChatResponse converts an Ollama response to backends.ChatChunk
func (a *Adapter) convertChatResponse(resp *ollamaChatResponse) *backends.ChatChunk {
	chunk := &backends.ChatChunk{
		Model:           resp.Model,
		CreatedAt:       resp.CreatedAt,
		Done:            resp.Done,
		DoneReason:      resp.DoneReason,
		PromptEvalCount: resp.PromptEvalCount,
		EvalCount:       resp.EvalCount,
	}

	if resp.Message.Role != "" || resp.Message.Content != "" {
		msg := &backends.ChatMessage{
			Role:    resp.Message.Role,
			Content: resp.Message.Content,
			Images:  resp.Message.Images,
		}

		// Convert tool calls
		for _, tc := range resp.Message.ToolCalls {
			msg.ToolCalls = append(msg.ToolCalls, backends.ToolCall{
				Type: "function",
				Function: struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				}{
					Name:      tc.Function.Name,
					Arguments: string(tc.Function.Arguments),
				},
			})
		}

		chunk.Message = msg
	}

	return chunk
}
