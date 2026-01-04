package backends

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"vessel-backend/internal/llm"
)

const (
	defaultLlamaCppPort    = 8080
	defaultLlamaCppTimeout = 120 * time.Second
)

// LlamaCppServerBackend implements the llm.Backend interface for llama.cpp server mode.
// It communicates with llama.cpp via its OpenAI-compatible API.
type LlamaCppServerBackend struct {
	name         string
	baseURL      string
	config       *llm.LlamaCppConfig
	httpClient   *http.Client
	capabilities []llm.Capability

	// Process management for embedded server
	mu      sync.RWMutex
	process *exec.Cmd
	managed bool // true if we manage the server process

	// Cancellation support
	cancelMu     sync.Mutex
	activeCancel context.CancelFunc
}

// Compile-time interface assertion
var _ llm.Backend = (*LlamaCppServerBackend)(nil)

// NewLlamaCppServerBackend creates a new llama.cpp server backend instance.
// If baseURL is empty, it defaults to http://localhost:8080.
// If config is nil, VulkanOptimizedPreset is used.
func NewLlamaCppServerBackend(name string, config *llm.LlamaCppConfig, baseURL string) (*LlamaCppServerBackend, error) {
	if name == "" {
		name = "llama-cpp"
	}

	if baseURL == "" {
		baseURL = fmt.Sprintf("http://localhost:%d", defaultLlamaCppPort)
	}

	// Normalize URL (remove trailing slash)
	baseURL = strings.TrimSuffix(baseURL, "/")

	if config == nil {
		preset := llm.VulkanOptimizedPreset
		config = &preset
	}

	return &LlamaCppServerBackend{
		name:    name,
		baseURL: baseURL,
		config:  config,
		httpClient: &http.Client{
			Timeout: defaultLlamaCppTimeout,
		},
		capabilities: []llm.Capability{
			llm.CapabilityChat,
			llm.CapabilityGenerate,
			llm.CapabilityStreaming,
		},
		managed: false,
	}, nil
}

// NewLlamaCppServerBackendFromConfig creates a backend from BackendConfig.
func NewLlamaCppServerBackendFromConfig(cfg *llm.BackendConfig) (*LlamaCppServerBackend, error) {
	if cfg.Type != llm.BackendLlamaCppServer {
		return nil, fmt.Errorf("invalid backend type: expected %s, got %s", llm.BackendLlamaCppServer, cfg.Type)
	}

	name := cfg.Name
	if name == "" {
		name = "llama-cpp"
	}

	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = defaultLlamaCppTimeout
	}

	backend, err := NewLlamaCppServerBackend(name, cfg.LlamaCpp, cfg.Endpoint)
	if err != nil {
		return nil, err
	}

	backend.httpClient.Timeout = timeout
	return backend, nil
}

// Name returns the backend instance name.
func (b *LlamaCppServerBackend) Name() string {
	return b.name
}

// Type returns the backend type identifier.
func (b *LlamaCppServerBackend) Type() llm.BackendType {
	return llm.BackendLlamaCppServer
}

// Ping checks if the llama.cpp server is available.
func (b *LlamaCppServerBackend) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/health", nil)
	if err != nil {
		return llm.NewBackendError(llm.BackendLlamaCppServer, "Ping", err)
	}

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return llm.NewCategorizedError(
			llm.BackendLlamaCppServer,
			"Ping",
			fmt.Errorf("%w: %v", llm.ErrBackendUnavailable, err),
			llm.ErrCategoryNetwork,
			"Ensure llama.cpp server is running and accessible",
		)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return llm.NewBackendErrorWithCode(
			llm.BackendLlamaCppServer,
			"Ping",
			fmt.Errorf("server returned status %d", resp.StatusCode),
			resp.StatusCode,
		)
	}

	return nil
}

// Available checks if the backend is reachable.
func (b *LlamaCppServerBackend) Available(ctx context.Context) bool {
	return b.Ping(ctx) == nil
}

// Capabilities returns the list of supported features.
func (b *LlamaCppServerBackend) Capabilities() []llm.Capability {
	return b.capabilities
}

// HasCapability checks if a specific capability is supported.
func (b *LlamaCppServerBackend) HasCapability(cap llm.Capability) bool {
	for _, c := range b.capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

// openAIChatRequest represents the OpenAI-compatible chat request format.
type openAIChatRequest struct {
	Model       string              `json:"model,omitempty"`
	Messages    []openAIChatMessage `json:"messages"`
	Stream      bool                `json:"stream"`
	Temperature *float64            `json:"temperature,omitempty"`
	TopP        *float64            `json:"top_p,omitempty"`
	MaxTokens   *int                `json:"max_tokens,omitempty"`
	Stop        []string            `json:"stop,omitempty"`
}

// openAIChatMessage represents a message in OpenAI format.
type openAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// openAIChatResponse represents a non-streaming OpenAI chat response.
type openAIChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int               `json:"index"`
		Message      openAIChatMessage `json:"message"`
		FinishReason string            `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// openAIStreamChunk represents a streaming chunk in SSE format.
type openAIStreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Role    string `json:"role,omitempty"`
			Content string `json:"content,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

// Chat performs a chat completion request.
func (b *LlamaCppServerBackend) Chat(ctx context.Context, req *llm.ChatRequest, callback llm.StreamCallback) (*llm.ChatResponse, error) {
	// Create cancellable context
	ctx, cancel := context.WithCancel(ctx)
	b.cancelMu.Lock()
	b.activeCancel = cancel
	b.cancelMu.Unlock()

	defer func() {
		b.cancelMu.Lock()
		b.activeCancel = nil
		b.cancelMu.Unlock()
	}()

	// Convert to OpenAI format
	openAIReq := b.convertToOpenAIRequest(req)

	body, err := json.Marshal(openAIReq)
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", fmt.Errorf("failed to marshal request: %w", err))
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := b.httpClient.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", llm.ErrContextCanceled)
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
func (b *LlamaCppServerBackend) handleStreamingResponse(ctx context.Context, body io.Reader, model string, callback llm.StreamCallback) (*llm.ChatResponse, error) {
	scanner := bufio.NewScanner(body)
	var finalResponse *llm.ChatResponse
	var fullContent strings.Builder
	var promptTokens, responseTokens int

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", llm.ErrContextCanceled)
		default:
		}

		line := scanner.Text()

		// Skip empty lines
		if line == "" {
			continue
		}

		// Handle SSE format
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		// Check for stream termination
		if data == "[DONE]" {
			break
		}

		var chunk openAIStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue // Skip malformed chunks
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]
		content := choice.Delta.Content
		fullContent.WriteString(content)

		// Extract usage from final chunk if available
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
			return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", err)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", fmt.Errorf("stream read error: %w", err))
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
func (b *LlamaCppServerBackend) handleNonStreamingResponse(body io.Reader, model string) (*llm.ChatResponse, error) {
	var resp openAIChatResponse
	if err := json.NewDecoder(body).Decode(&resp); err != nil {
		return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", fmt.Errorf("failed to decode response: %w", err))
	}

	if len(resp.Choices) == 0 {
		return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "Chat", fmt.Errorf("no choices in response"))
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
func (b *LlamaCppServerBackend) convertToOpenAIRequest(req *llm.ChatRequest) openAIChatRequest {
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
func (b *LlamaCppServerBackend) Cancel(ctx context.Context) error {
	// First, cancel any active context
	b.cancelMu.Lock()
	if b.activeCancel != nil {
		b.activeCancel()
	}
	b.cancelMu.Unlock()

	// If we manage the process, we can send SIGTERM as a last resort
	b.mu.RLock()
	process := b.process
	managed := b.managed
	b.mu.RUnlock()

	if managed && process != nil && process.Process != nil {
		// Try graceful abort via API first (some llama.cpp builds support this)
		abortReq, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+"/abort", nil)
		if err == nil {
			resp, err := b.httpClient.Do(abortReq)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}

		// Fallback: send SIGTERM to the process
		if err := process.Process.Signal(syscall.SIGTERM); err != nil {
			return llm.NewBackendError(llm.BackendLlamaCppServer, "Cancel", fmt.Errorf("failed to terminate process: %w", err))
		}
	}

	return nil
}

// healthResponse represents the /health endpoint response.
type healthResponse struct {
	Status         string `json:"status"`
	SlotsIdle      int    `json:"slots_idle"`
	SlotsProcessed int    `json:"slots_processed"`
}

// slotInfo represents slot information from /slots endpoint.
type slotInfo struct {
	ID           int     `json:"id"`
	State        int     `json:"state"`
	Model        string  `json:"model,omitempty"`
	Prompt       string  `json:"prompt,omitempty"`
	NCtx         int     `json:"n_ctx"`
	NPast        int     `json:"n_past"`
	NPredict     int     `json:"n_predict"`
	TokensSecond float64 `json:"tokens_per_second,omitempty"`
}

// propsResponse represents /props endpoint response.
type propsResponse struct {
	TotalSlots     int    `json:"total_slots"`
	ChatTemplate   string `json:"chat_template,omitempty"`
	DefaultGenSettings struct {
		NCtx     int `json:"n_ctx"`
		NPredict int `json:"n_predict"`
	} `json:"default_generation_settings"`
}

// Status returns the current backend status including performance metrics.
func (b *LlamaCppServerBackend) Status(ctx context.Context) (*llm.BackendStatus, error) {
	status := &llm.BackendStatus{
		Available: false,
	}

	// Check health endpoint
	healthReq, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/health", nil)
	if err != nil {
		return status, nil
	}

	healthResp, err := b.httpClient.Do(healthReq)
	if err != nil {
		return status, nil
	}
	defer healthResp.Body.Close()

	if healthResp.StatusCode != http.StatusOK {
		return status, nil
	}

	status.Available = true

	var health healthResponse
	if err := json.NewDecoder(healthResp.Body).Decode(&health); err == nil {
		status.QueueDepth = health.SlotsProcessed
	}

	// Try to get slot information for metrics
	slotsReq, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/slots", nil)
	if err == nil {
		slotsResp, err := b.httpClient.Do(slotsReq)
		if err == nil {
			defer slotsResp.Body.Close()
			if slotsResp.StatusCode == http.StatusOK {
				var slots []slotInfo
				if err := json.NewDecoder(slotsResp.Body).Decode(&slots); err == nil && len(slots) > 0 {
					// Use first active slot for metrics
					for _, slot := range slots {
						if slot.State > 0 {
							status.LoadedModel = slot.Model
							status.CurrentMetrics = &llm.GenerationMetrics{
								DecodeTokensPerSec: slot.TokensSecond,
								ContextUsed:        slot.NPast,
								ContextMax:         slot.NCtx,
							}
							break
						}
					}
				}
			}
		}
	}

	// Try to get props for additional info
	propsReq, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/props", nil)
	if err == nil {
		propsResp, err := b.httpClient.Do(propsReq)
		if err == nil {
			defer propsResp.Body.Close()
			if propsResp.StatusCode == http.StatusOK {
				var props propsResponse
				if err := json.NewDecoder(propsResp.Body).Decode(&props); err == nil {
					if status.CurrentMetrics == nil {
						status.CurrentMetrics = &llm.GenerationMetrics{}
					}
					status.CurrentMetrics.ContextMax = props.DefaultGenSettings.NCtx
				}
			}
		}
	}

	// Add config version if available
	if b.config != nil && b.config.Version != "" {
		status.Version = b.config.Version
	}

	return status, nil
}

// ListModels returns available models.
// Note: llama.cpp server typically runs with a single model, so this returns
// information about the currently loaded model.
func (b *LlamaCppServerBackend) ListModels(ctx context.Context) ([]llm.ModelInfo, error) {
	// Try /props endpoint first for model info
	propsReq, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/props", nil)
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "ListModels", err)
	}

	propsResp, err := b.httpClient.Do(propsReq)
	if err != nil {
		return nil, b.classifyHTTPError("ListModels", err)
	}
	defer propsResp.Body.Close()

	// Try /v1/models endpoint (OpenAI compatible)
	modelsReq, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL+"/v1/models", nil)
	if err == nil {
		modelsResp, err := b.httpClient.Do(modelsReq)
		if err == nil {
			defer modelsResp.Body.Close()
			if modelsResp.StatusCode == http.StatusOK {
				var modelsData struct {
					Data []struct {
						ID      string `json:"id"`
						Object  string `json:"object"`
						Created int64  `json:"created"`
						OwnedBy string `json:"owned_by"`
					} `json:"data"`
				}
				if err := json.NewDecoder(modelsResp.Body).Decode(&modelsData); err == nil && len(modelsData.Data) > 0 {
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
			}
		}
	}

	// Fallback: return a generic model entry based on props
	if propsResp.StatusCode == http.StatusOK {
		var props propsResponse
		if err := json.NewDecoder(propsResp.Body).Decode(&props); err == nil {
			return []llm.ModelInfo{
				{
					Name:          "default",
					ModifiedAt:    time.Now(),
					ContextLength: props.DefaultGenSettings.NCtx,
					Capabilities: []llm.Capability{
						llm.CapabilityChat,
						llm.CapabilityGenerate,
						llm.CapabilityStreaming,
					},
				},
			}, nil
		}
	}

	// Last resort: return empty list if server is available but provides no model info
	if b.Available(ctx) {
		return []llm.ModelInfo{
			{
				Name:       "default",
				ModifiedAt: time.Now(),
				Capabilities: []llm.Capability{
					llm.CapabilityChat,
					llm.CapabilityGenerate,
					llm.CapabilityStreaming,
				},
			},
		}, nil
	}

	return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "ListModels", llm.ErrBackendUnavailable)
}

// ShowModel returns detailed information about a specific model.
// Note: llama.cpp server has limited model introspection capabilities.
func (b *LlamaCppServerBackend) ShowModel(ctx context.Context, name string) (*llm.ModelDetails, error) {
	models, err := b.ListModels(ctx)
	if err != nil {
		return nil, err
	}

	for _, m := range models {
		if m.Name == name || name == "default" {
			return &llm.ModelDetails{
				ModelInfo: m,
			}, nil
		}
	}

	return nil, llm.NewBackendError(llm.BackendLlamaCppServer, "ShowModel", llm.ErrModelNotFound)
}

// Close releases any resources held by the backend.
func (b *LlamaCppServerBackend) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.managed && b.process != nil && b.process.Process != nil {
		// Graceful shutdown: SIGTERM, then wait, then SIGKILL if needed
		if err := b.process.Process.Signal(syscall.SIGTERM); err != nil {
			// Process might already be dead
			if !strings.Contains(err.Error(), "process already finished") {
				return llm.NewBackendError(llm.BackendLlamaCppServer, "Close", err)
			}
		}

		// Give it time to shutdown gracefully
		done := make(chan error, 1)
		go func() {
			done <- b.process.Wait()
		}()

		select {
		case <-done:
			// Process exited
		case <-time.After(5 * time.Second):
			// Force kill
			_ = b.process.Process.Kill()
		}

		b.process = nil
	}

	return nil
}

// StartServer starts an embedded llama.cpp server process.
// This is optional - the backend can also connect to an external server.
func (b *LlamaCppServerBackend) StartServer(ctx context.Context, binaryPath, modelPath string) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.process != nil {
		return llm.NewBackendError(llm.BackendLlamaCppServer, "StartServer", fmt.Errorf("server already running"))
	}

	// Build command arguments
	args := []string{
		"-m", modelPath,
		"--port", fmt.Sprintf("%d", defaultLlamaCppPort),
		"--host", "127.0.0.1",
	}

	// Add config-based arguments
	if b.config != nil {
		args = append(args, b.config.ToArgs()...)
	}

	cmd := exec.CommandContext(ctx, binaryPath, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return b.classifyStartError("StartServer", err)
	}

	b.process = cmd
	b.managed = true

	// Wait for server to become available
	if err := b.waitForReady(ctx, 30*time.Second); err != nil {
		// Clean up failed process
		_ = cmd.Process.Kill()
		b.process = nil
		b.managed = false
		return err
	}

	return nil
}

// waitForReady polls the health endpoint until the server is ready.
func (b *LlamaCppServerBackend) waitForReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return llm.NewBackendError(llm.BackendLlamaCppServer, "StartServer", llm.ErrContextCanceled)
		default:
		}

		if b.Available(ctx) {
			return nil
		}

		time.Sleep(100 * time.Millisecond)
	}

	return llm.NewCategorizedError(
		llm.BackendLlamaCppServer,
		"StartServer",
		fmt.Errorf("server failed to start within %v", timeout),
		llm.ErrCategoryBackendInit,
		"Check llama.cpp logs for errors",
	)
}

// classifyHTTPError categorizes HTTP connection errors.
func (b *LlamaCppServerBackend) classifyHTTPError(op string, err error) *llm.BackendError {
	category := llm.ClassifyError(err)
	suggestion := ""

	switch category {
	case llm.ErrCategoryNetwork:
		suggestion = "Ensure llama.cpp server is running and accessible"
	case llm.ErrCategoryVRAM:
		suggestion = "Try reducing context size or batch size in configuration"
	}

	return llm.NewCategorizedError(llm.BackendLlamaCppServer, op, err, category, suggestion).
		WithContext(&llm.ErrorContext{
			EngineVersion: b.config.Version,
			FlagsUsed:     b.config.ToArgs(),
		})
}

// handleHTTPError processes HTTP error responses.
func (b *LlamaCppServerBackend) handleHTTPError(op string, resp *http.Response) *llm.BackendError {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	errMsg := string(body)

	var category llm.ErrorCategory
	var suggestion string

	switch {
	case resp.StatusCode == http.StatusServiceUnavailable:
		category = llm.ErrCategoryRuntime
		suggestion = "Server is overloaded or model is loading"
	case resp.StatusCode >= 500:
		category = llm.ErrCategoryRuntime
		// Check for common llama.cpp errors in body
		if strings.Contains(strings.ToLower(errMsg), "out of memory") ||
			strings.Contains(strings.ToLower(errMsg), "oom") ||
			strings.Contains(strings.ToLower(errMsg), "vram") {
			category = llm.ErrCategoryVRAM
			suggestion = "Reduce context size or use a smaller model"
		}
	case resp.StatusCode == http.StatusBadRequest:
		category = llm.ErrCategoryValidation
		suggestion = "Check request parameters"
	default:
		category = llm.ErrCategoryUnknown
	}

	return llm.NewCategorizedError(
		llm.BackendLlamaCppServer,
		op,
		fmt.Errorf("HTTP %d: %s", resp.StatusCode, errMsg),
		category,
		suggestion,
	).WithContext(&llm.ErrorContext{
		EngineVersion: b.config.Version,
		FlagsUsed:     b.config.ToArgs(),
	})
}

// classifyStartError categorizes server startup errors.
func (b *LlamaCppServerBackend) classifyStartError(op string, err error) *llm.BackendError {
	errStr := strings.ToLower(err.Error())

	var category llm.ErrorCategory
	var suggestion string

	switch {
	case strings.Contains(errStr, "executable file not found"):
		category = llm.ErrCategoryBackendInit
		suggestion = "Install llama.cpp or provide correct binary path"
	case strings.Contains(errStr, "permission denied"):
		category = llm.ErrCategoryBackendInit
		suggestion = "Check file permissions on llama.cpp binary"
	case strings.Contains(errStr, "vulkan") || strings.Contains(errStr, "cuda"):
		category = llm.ErrCategoryBackendInit
		suggestion = "GPU initialization failed - check drivers and GPU support"
	default:
		category = llm.ErrCategoryBackendInit
		suggestion = "Check llama.cpp installation and configuration"
	}

	return llm.NewCategorizedError(llm.BackendLlamaCppServer, op, err, category, suggestion).
		WithContext(&llm.ErrorContext{
			EngineVersion: b.config.Version,
			FlagsUsed:     b.config.ToArgs(),
		})
}
