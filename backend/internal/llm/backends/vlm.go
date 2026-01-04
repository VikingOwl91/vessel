package backends

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"vessel-backend/internal/llm"
)

const (
	defaultVLMTimeout = 120 * time.Second
)

// VLMBackend implements the llm.Backend interface for VLM (Vessel Llama Manager).
// VLM is a host-native daemon that manages llama.cpp processes with safe switching,
// scheduling, and authentication.
type VLMBackend struct {
	name         string
	baseURL      string
	token        string
	httpClient   *http.Client
	capabilities []llm.Capability
	interactive  bool // true for UI requests (gets scheduler priority)
}

// Compile-time interface assertion
var _ llm.Backend = (*VLMBackend)(nil)

// NewVLMBackend creates a new VLM backend instance.
func NewVLMBackend(name, baseURL, token string) (*VLMBackend, error) {
	if name == "" {
		name = "vlm"
	}

	if baseURL == "" {
		baseURL = "http://localhost:32789"
	}

	// Normalize URL (remove trailing slash)
	baseURL = strings.TrimSuffix(baseURL, "/")

	return &VLMBackend{
		name:    name,
		baseURL: baseURL,
		token:   token,
		httpClient: &http.Client{
			Timeout: defaultVLMTimeout,
		},
		capabilities: []llm.Capability{
			llm.CapabilityChat,
			llm.CapabilityGenerate,
			llm.CapabilityStreaming,
		},
		interactive: true, // Default to interactive for UI requests
	}, nil
}

// NewVLMBackendFromConfig creates a VLM backend from BackendConfig.
func NewVLMBackendFromConfig(cfg *llm.BackendConfig) (*VLMBackend, error) {
	if cfg.Type != llm.BackendVLM {
		return nil, fmt.Errorf("invalid backend type: expected %s, got %s", llm.BackendVLM, cfg.Type)
	}

	name := cfg.Name
	if name == "" {
		name = "vlm"
	}

	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = defaultVLMTimeout
	}

	// Get token from config options
	token := ""
	if cfg.Options != nil {
		if t, ok := cfg.Options["token"].(string); ok {
			token = t
		}
	}

	backend, err := NewVLMBackend(name, cfg.Endpoint, token)
	if err != nil {
		return nil, err
	}

	backend.httpClient.Timeout = timeout
	return backend, nil
}

// SetInteractive sets whether this backend should be treated as interactive.
// Interactive requests get priority in VLM's scheduler.
func (b *VLMBackend) SetInteractive(interactive bool) {
	b.interactive = interactive
}

// Name returns the backend instance name.
func (b *VLMBackend) Name() string {
	return b.name
}

// Type returns the backend type identifier.
func (b *VLMBackend) Type() llm.BackendType {
	return llm.BackendVLM
}

// doRequest makes an HTTP request with VLM authentication headers.
func (b *VLMBackend) doRequest(req *http.Request) (*http.Response, error) {
	// Add auth header if token is configured
	if b.token != "" {
		req.Header.Set("Authorization", "Bearer "+b.token)
	}

	// Add interactive header for scheduler priority
	if b.interactive {
		req.Header.Set("X-VLM-Interactive", "1")
	} else {
		req.Header.Set("X-VLM-Interactive", "0")
	}

	return b.httpClient.Do(req)
}

// Ping checks if VLM is available.
func (b *VLMBackend) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/vlm/health", nil)
	if err != nil {
		return llm.NewBackendError(llm.BackendVLM, "Ping", err)
	}

	resp, err := b.doRequest(req)
	if err != nil {
		return llm.NewCategorizedError(
			llm.BackendVLM,
			"Ping",
			fmt.Errorf("%w: %v", llm.ErrBackendUnavailable, err),
			llm.ErrCategoryNetwork,
			"Ensure VLM daemon is running (vlm --config ~/.vessel/llm.toml)",
		)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return llm.NewBackendErrorWithCode(
			llm.BackendVLM,
			"Ping",
			fmt.Errorf("VLM returned status %d", resp.StatusCode),
			resp.StatusCode,
		)
	}

	return nil
}

// Available checks if VLM is reachable.
func (b *VLMBackend) Available(ctx context.Context) bool {
	return b.Ping(ctx) == nil
}

// Capabilities returns the list of supported features.
func (b *VLMBackend) Capabilities() []llm.Capability {
	return b.capabilities
}

// HasCapability checks if a specific capability is supported.
func (b *VLMBackend) HasCapability(cap llm.Capability) bool {
	for _, c := range b.capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

// Chat performs a chat completion request via VLM.
func (b *VLMBackend) Chat(ctx context.Context, req *llm.ChatRequest, callback llm.StreamCallback) (*llm.ChatResponse, error) {
	// Convert to OpenAI format
	openAIReq := b.convertToOpenAIRequest(req)

	body, err := json.Marshal(openAIReq)
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendVLM, "Chat", fmt.Errorf("failed to marshal request: %w", err))
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendVLM, "Chat", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := b.doRequest(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return nil, llm.NewBackendError(llm.BackendVLM, "Chat", llm.ErrContextCanceled)
		}
		return nil, b.classifyHTTPError("Chat", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, b.handleHTTPError("Chat", resp)
	}

	if req.Stream && callback != nil {
		return b.handleStreamingResponse(ctx, resp.Body, req.Model, callback)
	}

	return b.handleNonStreamingResponse(resp.Body, req.Model)
}

// handleStreamingResponse processes SSE streaming responses.
func (b *VLMBackend) handleStreamingResponse(ctx context.Context, body io.Reader, model string, callback llm.StreamCallback) (*llm.ChatResponse, error) {
	scanner := bufio.NewScanner(body)
	var finalResponse *llm.ChatResponse
	var fullContent strings.Builder
	var promptTokens, responseTokens int

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, llm.NewBackendError(llm.BackendVLM, "Chat", llm.ErrContextCanceled)
		default:
		}

		line := scanner.Text()

		if line == "" {
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		if data == "[DONE]" {
			break
		}

		var chunk openAIStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]
		content := choice.Delta.Content
		fullContent.WriteString(content)

		if chunk.Usage != nil {
			promptTokens = chunk.Usage.PromptTokens
			responseTokens = chunk.Usage.CompletionTokens
		}

		done := choice.FinishReason != nil
		doneReason := ""
		if done && choice.FinishReason != nil {
			doneReason = *choice.FinishReason
		}

		llmResp := llm.ChatResponse{
			Model: model,
			Message: llm.Message{
				Role:    "assistant",
				Content: content,
			},
			Done:           done,
			DoneReason:     doneReason,
			PromptTokens:   promptTokens,
			ResponseTokens: responseTokens,
		}

		finalResponse = &llm.ChatResponse{
			Model: model,
			Message: llm.Message{
				Role:    "assistant",
				Content: fullContent.String(),
			},
			Done:           done,
			DoneReason:     doneReason,
			PromptTokens:   promptTokens,
			ResponseTokens: responseTokens,
		}

		if err := callback(llmResp); err != nil {
			return nil, llm.NewBackendError(llm.BackendVLM, "Chat", err)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, llm.NewBackendError(llm.BackendVLM, "Chat", fmt.Errorf("stream read error: %w", err))
	}

	if finalResponse == nil {
		finalResponse = &llm.ChatResponse{
			Model: model,
			Message: llm.Message{
				Role:    "assistant",
				Content: fullContent.String(),
			},
			Done: true,
		}
	}

	return finalResponse, nil
}

// handleNonStreamingResponse processes non-streaming responses.
func (b *VLMBackend) handleNonStreamingResponse(body io.Reader, model string) (*llm.ChatResponse, error) {
	var resp openAIChatResponse
	if err := json.NewDecoder(body).Decode(&resp); err != nil {
		return nil, llm.NewBackendError(llm.BackendVLM, "Chat", fmt.Errorf("failed to decode response: %w", err))
	}

	if len(resp.Choices) == 0 {
		return nil, llm.NewBackendError(llm.BackendVLM, "Chat", fmt.Errorf("no choices in response"))
	}

	choice := resp.Choices[0]
	return &llm.ChatResponse{
		Model: model,
		Message: llm.Message{
			Role:    choice.Message.Role,
			Content: choice.Message.Content,
		},
		Done:           true,
		DoneReason:     choice.FinishReason,
		PromptTokens:   resp.Usage.PromptTokens,
		ResponseTokens: resp.Usage.CompletionTokens,
	}, nil
}

// convertToOpenAIRequest converts llm.ChatRequest to OpenAI format.
func (b *VLMBackend) convertToOpenAIRequest(req *llm.ChatRequest) openAIChatRequest {
	messages := make([]openAIChatMessage, len(req.Messages))
	for i, m := range req.Messages {
		messages[i] = openAIChatMessage{
			Role:    m.Role,
			Content: m.Content,
		}
	}

	return openAIChatRequest{
		Model:       req.Model,
		Messages:    messages,
		Stream:      req.Stream,
		Temperature: req.Temperature,
		TopP:        req.TopP,
		MaxTokens:   req.MaxTokens,
		Stop:        req.StopWords,
	}
}

// Cancel aborts any in-progress generation.
func (b *VLMBackend) Cancel(ctx context.Context) error {
	// VLM handles cancellation via context propagation
	// When the HTTP request is cancelled, VLM cancels the upstream request
	return nil
}

// Status returns the current VLM status.
func (b *VLMBackend) Status(ctx context.Context) (*llm.BackendStatus, error) {
	status := &llm.BackendStatus{
		Available: false,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/vlm/status", nil)
	if err != nil {
		return status, nil
	}

	resp, err := b.doRequest(req)
	if err != nil {
		return status, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return status, nil
	}

	var vlmStatus struct {
		State        string `json:"state"`
		ModelID      string `json:"model_id"`
		Profile      string `json:"profile"`
		UpstreamPort int    `json:"upstream_port"`
		Uptime       string `json:"uptime"`
		Scheduler    struct {
			ActiveInteractive int32 `json:"active_interactive"`
			ActiveWorker      int32 `json:"active_worker"`
			Queued            int32 `json:"queued_requests"`
		} `json:"scheduler"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&vlmStatus); err != nil {
		return status, nil
	}

	status.Available = vlmStatus.State == "running"
	status.LoadedModel = vlmStatus.ModelID
	status.QueueDepth = int(vlmStatus.Scheduler.Queued)

	return status, nil
}

// ListModels returns available models from VLM.
func (b *VLMBackend) ListModels(ctx context.Context) ([]llm.ModelInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendVLM, "ListModels", err)
	}

	resp, err := b.doRequest(req)
	if err != nil {
		return nil, b.classifyHTTPError("ListModels", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, b.handleHTTPError("ListModels", resp)
	}

	var modelsData struct {
		Data []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			OwnedBy string `json:"owned_by"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&modelsData); err != nil {
		return nil, llm.NewBackendError(llm.BackendVLM, "ListModels", fmt.Errorf("failed to decode response: %w", err))
	}

	models := make([]llm.ModelInfo, len(modelsData.Data))
	for i, m := range modelsData.Data {
		models[i] = llm.ModelInfo{
			Name:       m.ID,
			ModifiedAt: time.Unix(m.Created, 0),
			Capabilities: []llm.Capability{
				llm.CapabilityChat,
				llm.CapabilityGenerate,
				llm.CapabilityStreaming,
			},
		}
	}

	return models, nil
}

// ShowModel returns information about a specific model.
func (b *VLMBackend) ShowModel(ctx context.Context, name string) (*llm.ModelDetails, error) {
	models, err := b.ListModels(ctx)
	if err != nil {
		return nil, err
	}

	for _, m := range models {
		if m.Name == name {
			return &llm.ModelDetails{
				ModelInfo: m,
			}, nil
		}
	}

	return nil, llm.NewBackendError(llm.BackendVLM, "ShowModel", llm.ErrModelNotFound)
}

// Close releases any resources.
func (b *VLMBackend) Close() error {
	return nil
}

// SelectModel requests VLM to load a specific model.
func (b *VLMBackend) SelectModel(ctx context.Context, modelID, profile string) error {
	reqBody := map[string]string{
		"model_id": modelID,
	}
	if profile != "" {
		reqBody["profile"] = profile
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return llm.NewBackendError(llm.BackendVLM, "SelectModel", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+"/vlm/models/select", bytes.NewReader(body))
	if err != nil {
		return llm.NewBackendError(llm.BackendVLM, "SelectModel", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.doRequest(req)
	if err != nil {
		return b.classifyHTTPError("SelectModel", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return b.handleHTTPError("SelectModel", resp)
	}

	return nil
}

// classifyHTTPError categorizes HTTP connection errors.
func (b *VLMBackend) classifyHTTPError(op string, err error) *llm.BackendError {
	category := llm.ClassifyError(err)
	suggestion := ""

	switch category {
	case llm.ErrCategoryNetwork:
		suggestion = "Ensure VLM daemon is running"
	}

	return llm.NewCategorizedError(llm.BackendVLM, op, err, category, suggestion)
}

// handleHTTPError processes HTTP error responses.
func (b *VLMBackend) handleHTTPError(op string, resp *http.Response) *llm.BackendError {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))

	// Parse VLM error response
	var vlmErr struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	json.Unmarshal(body, &vlmErr)

	var category llm.ErrorCategory
	var suggestion string

	switch vlmErr.Code {
	case "MODEL_NOT_SELECTED":
		category = llm.ErrCategoryBackendInit
		suggestion = "Select a model first via /vlm/models/select"
	case "MODEL_SWITCHING":
		category = llm.ErrCategoryRuntime
		suggestion = "Model switch in progress, retry in a few seconds"
	case "QUEUE_FULL":
		category = llm.ErrCategoryRuntime
		suggestion = "Server is busy, retry with backoff"
	case "UPSTREAM_UNAVAILABLE":
		category = llm.ErrCategoryNetwork
		suggestion = "llama-server crashed, check VLM logs"
	case "UNAUTHORIZED":
		category = llm.ErrCategoryValidation
		suggestion = "Check VLM_TOKEN configuration"
	default:
		category = llm.ErrCategoryUnknown
		suggestion = vlmErr.Error
	}

	errMsg := vlmErr.Error
	if errMsg == "" {
		errMsg = string(body)
	}

	return llm.NewCategorizedError(
		llm.BackendVLM,
		op,
		fmt.Errorf("HTTP %d: %s", resp.StatusCode, errMsg),
		category,
		suggestion,
	)
}
