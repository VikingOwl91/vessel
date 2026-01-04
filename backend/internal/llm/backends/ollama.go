// Package backends provides implementations of the llm.Backend interface
// for various LLM providers.
package backends

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/ollama/ollama/api"
	"vessel-backend/internal/llm"
)

// OllamaBackend implements the llm.Backend interface for Ollama.
// It also implements PullableBackend, DeletableBackend, CreatableBackend,
// CopyableBackend, and EmbeddableBackend.
type OllamaBackend struct {
	client       *api.Client
	name         string
	endpoint     string
	capabilities []llm.Capability
}

// Compile-time interface assertions
var (
	_ llm.Backend          = (*OllamaBackend)(nil)
	_ llm.PullableBackend  = (*OllamaBackend)(nil)
	_ llm.DeletableBackend = (*OllamaBackend)(nil)
	_ llm.CreatableBackend = (*OllamaBackend)(nil)
	_ llm.CopyableBackend  = (*OllamaBackend)(nil)
	_ llm.EmbeddableBackend = (*OllamaBackend)(nil)
)

// NewOllamaBackend creates a new Ollama backend instance.
func NewOllamaBackend(cfg *llm.BackendConfig) (*OllamaBackend, error) {
	if cfg.Type != llm.BackendOllama {
		return nil, fmt.Errorf("invalid backend type: expected %s, got %s", llm.BackendOllama, cfg.Type)
	}

	baseURL, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid Ollama URL %q: %w", cfg.Endpoint, err)
	}

	httpClient := &http.Client{
		Timeout: cfg.Timeout,
	}
	client := api.NewClient(baseURL, httpClient)

	name := cfg.Name
	if name == "" {
		name = "ollama"
	}

	return &OllamaBackend{
		client:   client,
		name:     name,
		endpoint: cfg.Endpoint,
		capabilities: []llm.Capability{
			llm.CapabilityChat,
			llm.CapabilityGenerate,
			llm.CapabilityEmbed,
			llm.CapabilityVision,
			llm.CapabilityTools,
			llm.CapabilityPull,
			llm.CapabilityDelete,
			llm.CapabilityCreate,
			llm.CapabilityStreaming,
		},
	}, nil
}

// Name returns the backend instance name.
func (b *OllamaBackend) Name() string {
	return b.name
}

// Type returns the backend type identifier.
func (b *OllamaBackend) Type() llm.BackendType {
	return llm.BackendOllama
}

// Ping checks if Ollama is available.
func (b *OllamaBackend) Ping(ctx context.Context) error {
	if err := b.client.Heartbeat(ctx); err != nil {
		return llm.NewBackendError(llm.BackendOllama, "Ping", fmt.Errorf("%w: %v", llm.ErrBackendUnavailable, err))
	}
	return nil
}

// Available checks if the backend is reachable.
func (b *OllamaBackend) Available(ctx context.Context) bool {
	return b.Ping(ctx) == nil
}

// Capabilities returns the list of supported features.
func (b *OllamaBackend) Capabilities() []llm.Capability {
	return b.capabilities
}

// HasCapability checks if a specific capability is supported.
func (b *OllamaBackend) HasCapability(cap llm.Capability) bool {
	for _, c := range b.capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

// Chat performs a chat completion request.
func (b *OllamaBackend) Chat(ctx context.Context, req *llm.ChatRequest, callback llm.StreamCallback) (*llm.ChatResponse, error) {
	ollamaReq := convertChatRequestToOllama(req)

	var finalResponse *llm.ChatResponse

	err := b.client.Chat(ctx, ollamaReq, func(resp api.ChatResponse) error {
		llmResp := convertOllamaChatResponse(resp)
		finalResponse = &llmResp

		if callback != nil && req.Stream {
			if err := callback(llmResp); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		if ctx.Err() != nil {
			return nil, llm.NewBackendError(llm.BackendOllama, "Chat", llm.ErrContextCanceled)
		}
		return nil, llm.NewBackendError(llm.BackendOllama, "Chat", err)
	}

	return finalResponse, nil
}

// ListModels returns all available models.
func (b *OllamaBackend) ListModels(ctx context.Context) ([]llm.ModelInfo, error) {
	resp, err := b.client.List(ctx)
	if err != nil {
		return nil, llm.NewBackendError(llm.BackendOllama, "ListModels", err)
	}

	models := make([]llm.ModelInfo, len(resp.Models))
	for i, m := range resp.Models {
		models[i] = convertOllamaModel(m)
	}
	return models, nil
}

// ShowModel returns detailed information about a model.
func (b *OllamaBackend) ShowModel(ctx context.Context, name string) (*llm.ModelDetails, error) {
	resp, err := b.client.Show(ctx, &api.ShowRequest{Name: name})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return nil, llm.NewBackendError(llm.BackendOllama, "ShowModel", llm.ErrModelNotFound)
		}
		return nil, llm.NewBackendError(llm.BackendOllama, "ShowModel", err)
	}

	return convertOllamaShowResponse(name, resp), nil
}

// Cancel aborts any in-progress generation.
// For Ollama, cancellation is handled via context cancellation in the Chat/Generate calls.
// This method is a no-op since Ollama doesn't have a separate cancel endpoint.
func (b *OllamaBackend) Cancel(ctx context.Context) error {
	// Ollama handles cancellation through context cancellation
	// There's no separate cancel API endpoint
	return nil
}

// Status returns the current backend status including loaded models and metrics.
func (b *OllamaBackend) Status(ctx context.Context) (*llm.BackendStatus, error) {
	status := &llm.BackendStatus{
		Available: false,
	}

	// Check if Ollama is reachable
	if err := b.client.Heartbeat(ctx); err != nil {
		return status, nil // Return status with Available=false
	}
	status.Available = true

	// Get version info
	version, err := b.client.Version(ctx)
	if err == nil {
		status.Version = version
	}

	// Get currently running/loaded models via /api/ps
	running, err := b.client.ListRunning(ctx)
	if err == nil && len(running.Models) > 0 {
		// Report the first running model as the loaded model
		status.LoadedModel = running.Models[0].Name

		// Extract metrics from running model info if available
		if running.Models[0].SizeVRAM > 0 {
			status.GPUMemoryUsed = int64(running.Models[0].SizeVRAM)
		}
		if running.Models[0].Size > 0 {
			status.GPUMemoryTotal = int64(running.Models[0].Size)
		}
	}

	return status, nil
}

// Close releases any resources held by the backend.
func (b *OllamaBackend) Close() error {
	// Ollama client doesn't require explicit cleanup
	return nil
}

// PullModel downloads a model from the Ollama registry.
func (b *OllamaBackend) PullModel(ctx context.Context, name string, callback llm.PullCallback) error {
	err := b.client.Pull(ctx, &api.PullRequest{Name: name}, func(resp api.ProgressResponse) error {
		if callback != nil {
			progress := llm.PullProgress{
				Status:    resp.Status,
				Digest:    resp.Digest,
				Total:     resp.Total,
				Completed: resp.Completed,
			}
			return callback(progress)
		}
		return nil
	})

	if err != nil {
		if ctx.Err() != nil {
			return llm.NewBackendError(llm.BackendOllama, "PullModel", llm.ErrContextCanceled)
		}
		return llm.NewBackendError(llm.BackendOllama, "PullModel", err)
	}
	return nil
}

// DeleteModel removes a model from Ollama.
func (b *OllamaBackend) DeleteModel(ctx context.Context, name string) error {
	err := b.client.Delete(ctx, &api.DeleteRequest{Name: name})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return llm.NewBackendError(llm.BackendOllama, "DeleteModel", llm.ErrModelNotFound)
		}
		return llm.NewBackendError(llm.BackendOllama, "DeleteModel", err)
	}
	return nil
}

// CreateModel creates a new model from a base model with a system prompt.
// The modelfile parameter is interpreted as a system prompt to embed in the new model.
// The name should be in format "newmodel:tag" and will be created from the base model.
func (b *OllamaBackend) CreateModel(ctx context.Context, name, modelfile string, callback llm.PullCallback) error {
	// Parse the modelfile to extract base model and system prompt
	// Expected format: "FROM basemodel\nSYSTEM prompt" or just a system prompt
	var from, system string
	lines := strings.Split(modelfile, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToUpper(line), "FROM ") {
			from = strings.TrimSpace(line[5:])
		} else if strings.HasPrefix(strings.ToUpper(line), "SYSTEM ") {
			system = strings.TrimSpace(line[7:])
		} else if system == "" && line != "" {
			// If no SYSTEM prefix, treat the whole thing as system prompt
			system = modelfile
		}
	}

	req := &api.CreateRequest{
		Model:  name,
		From:   from,
		System: system,
	}

	err := b.client.Create(ctx, req, func(resp api.ProgressResponse) error {
		if callback != nil {
			progress := llm.PullProgress{
				Status:    resp.Status,
				Digest:    resp.Digest,
				Total:     resp.Total,
				Completed: resp.Completed,
			}
			return callback(progress)
		}
		return nil
	})

	if err != nil {
		if ctx.Err() != nil {
			return llm.NewBackendError(llm.BackendOllama, "CreateModel", llm.ErrContextCanceled)
		}
		return llm.NewBackendError(llm.BackendOllama, "CreateModel", err)
	}
	return nil
}

// CopyModel creates a copy of an existing model.
func (b *OllamaBackend) CopyModel(ctx context.Context, source, destination string) error {
	err := b.client.Copy(ctx, &api.CopyRequest{
		Source:      source,
		Destination: destination,
	})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return llm.NewBackendError(llm.BackendOllama, "CopyModel", llm.ErrModelNotFound)
		}
		return llm.NewBackendError(llm.BackendOllama, "CopyModel", err)
	}
	return nil
}

// Embed generates embeddings for the given input texts.
func (b *OllamaBackend) Embed(ctx context.Context, req *llm.EmbedRequest) (*llm.EmbedResponse, error) {
	ollamaReq := &api.EmbedRequest{
		Model: req.Model,
		Input: req.Input,
	}

	resp, err := b.client.Embed(ctx, ollamaReq)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return nil, llm.NewBackendError(llm.BackendOllama, "Embed", llm.ErrModelNotFound)
		}
		return nil, llm.NewBackendError(llm.BackendOllama, "Embed", err)
	}

	// Convert [][]float32 to [][]float64
	embeddings := make([][]float64, len(resp.Embeddings))
	for i, emb := range resp.Embeddings {
		embeddings[i] = make([]float64, len(emb))
		for j, v := range emb {
			embeddings[i][j] = float64(v)
		}
	}

	return &llm.EmbedResponse{
		Model:        resp.Model,
		Embeddings:   embeddings,
		PromptTokens: resp.PromptEvalCount,
	}, nil
}

// --- Conversion helpers ---

// convertChatRequestToOllama converts llm.ChatRequest to api.ChatRequest.
func convertChatRequestToOllama(req *llm.ChatRequest) *api.ChatRequest {
	messages := convertMessagesToOllama(req.Messages)
	tools := convertToolsToOllama(req.Tools)

	ollamaReq := &api.ChatRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   &req.Stream,
		Tools:    tools,
	}

	// Set format if specified
	if req.Format == "json" {
		ollamaReq.Format = json.RawMessage(`"json"`)
	}

	// Build options map
	opts := make(map[string]any)
	if req.Temperature != nil {
		opts["temperature"] = *req.Temperature
	}
	if req.TopP != nil {
		opts["top_p"] = *req.TopP
	}
	if req.TopK != nil {
		opts["top_k"] = *req.TopK
	}
	if req.MaxTokens != nil {
		opts["num_predict"] = *req.MaxTokens
	}
	if len(req.StopWords) > 0 {
		opts["stop"] = req.StopWords
	}

	// Merge with request-specific options
	for k, v := range req.Options {
		opts[k] = v
	}

	if len(opts) > 0 {
		ollamaReq.Options = opts
	}

	return ollamaReq
}

// convertMessagesToOllama converts llm.Message slice to api.Message slice.
func convertMessagesToOllama(messages []llm.Message) []api.Message {
	result := make([]api.Message, len(messages))
	for i, m := range messages {
		msg := api.Message{
			Role:    m.Role,
			Content: m.Content,
		}

		// Convert images (base64 strings to []byte)
		if len(m.Images) > 0 {
			msg.Images = make([]api.ImageData, len(m.Images))
			for j, img := range m.Images {
				msg.Images[j] = api.ImageData(img)
			}
		}

		// Convert tool calls
		if len(m.ToolCalls) > 0 {
			msg.ToolCalls = make([]api.ToolCall, len(m.ToolCalls))
			for j, tc := range m.ToolCalls {
				// Parse arguments JSON string to map
				var args map[string]any
				if tc.Function.Arguments != "" {
					_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
				}
				msg.ToolCalls[j] = api.ToolCall{
					Function: api.ToolCallFunction{
						Name:      tc.Function.Name,
						Arguments: args,
					},
				}
			}
		}

		result[i] = msg
	}
	return result
}

// convertToolsToOllama converts llm.Tool slice to api.Tool slice.
func convertToolsToOllama(tools []llm.Tool) []api.Tool {
	if len(tools) == 0 {
		return nil
	}

	result := make([]api.Tool, len(tools))
	for i, t := range tools {
		params := api.ToolFunctionParameters{
			Type:       "object",
			Properties: make(map[string]api.ToolProperty),
		}

		// Copy parameters if present
		if t.Function.Parameters != nil {
			if typ, ok := t.Function.Parameters["type"].(string); ok {
				params.Type = typ
			}
			if req, ok := t.Function.Parameters["required"].([]string); ok {
				params.Required = req
			}
			if props, ok := t.Function.Parameters["properties"].(map[string]any); ok {
				for name, prop := range props {
					if propMap, ok := prop.(map[string]any); ok {
						toolProp := api.ToolProperty{}
						if typ, ok := propMap["type"].(string); ok {
							toolProp.Type = api.PropertyType{typ}
						}
						if desc, ok := propMap["description"].(string); ok {
							toolProp.Description = desc
						}
						if enum, ok := propMap["enum"].([]any); ok {
							toolProp.Enum = enum
						}
						params.Properties[name] = toolProp
					}
				}
			}
		}

		result[i] = api.Tool{
			Type: t.Type,
			Function: api.ToolFunction{
				Name:        t.Function.Name,
				Description: t.Function.Description,
				Parameters:  params,
			},
		}
	}
	return result
}

// convertOllamaChatResponse converts api.ChatResponse to llm.ChatResponse.
func convertOllamaChatResponse(resp api.ChatResponse) llm.ChatResponse {
	result := llm.ChatResponse{
		Model: resp.Model,
		Done:  resp.Done,
		Message: llm.Message{
			Role:    resp.Message.Role,
			Content: resp.Message.Content,
		},
		DoneReason:         resp.DoneReason,
		PromptTokens:       resp.PromptEvalCount,
		ResponseTokens:     resp.EvalCount,
		TotalDuration:      resp.TotalDuration,
		LoadDuration:       resp.LoadDuration,
		PromptEvalDuration: resp.PromptEvalDuration,
		EvalDuration:       resp.EvalDuration,
	}

	// Convert tool calls
	if len(resp.Message.ToolCalls) > 0 {
		result.Message.ToolCalls = make([]llm.ToolCall, len(resp.Message.ToolCalls))
		for i, tc := range resp.Message.ToolCalls {
			// Convert arguments map to JSON string
			argsJSON, _ := json.Marshal(tc.Function.Arguments)
			result.Message.ToolCalls[i] = llm.ToolCall{
				Type: "function",
				Function: llm.ToolFunction{
					Name:      tc.Function.Name,
					Arguments: string(argsJSON),
				},
			}
		}
	}

	return result
}

// convertOllamaModel converts api.ListModelResponse to llm.ModelInfo.
func convertOllamaModel(m api.ListModelResponse) llm.ModelInfo {
	info := llm.ModelInfo{
		Name:       m.Name,
		ModifiedAt: m.ModifiedAt,
		Size:       m.Size,
		Digest:     m.Digest,
	}

	// Extract details if available
	if m.Details.Family != "" {
		info.Family = m.Details.Family
	}
	if m.Details.ParameterSize != "" {
		info.ParameterSize = m.Details.ParameterSize
	}
	if m.Details.QuantizationLevel != "" {
		info.QuantLevel = m.Details.QuantizationLevel
	}

	return info
}

// convertOllamaShowResponse converts api.ShowResponse to llm.ModelDetails.
func convertOllamaShowResponse(name string, resp *api.ShowResponse) *llm.ModelDetails {
	details := &llm.ModelDetails{
		ModelInfo: llm.ModelInfo{
			Name:       name,
			ModifiedAt: resp.ModifiedAt,
		},
		License:      resp.License,
		Modelfile:    resp.Modelfile,
		Parameters:   resp.Parameters,
		Template:     resp.Template,
		SystemPrompt: resp.System,
	}

	// Extract model info details
	if resp.Details.Family != "" {
		details.Family = resp.Details.Family
	}
	if resp.Details.ParameterSize != "" {
		details.ParameterSize = resp.Details.ParameterSize
	}
	if resp.Details.QuantizationLevel != "" {
		details.QuantLevel = resp.Details.QuantizationLevel
	}

	// Extract model info from model info struct if available
	if resp.ModelInfo != nil {
		if ctxLen, ok := resp.ModelInfo["general.context_length"].(float64); ok {
			details.ContextLength = int(ctxLen)
		}
	}

	// Determine capabilities from model info
	capabilities := []llm.Capability{llm.CapabilityChat, llm.CapabilityGenerate}

	// Check for vision capability (common patterns)
	lowerName := strings.ToLower(name)
	if strings.Contains(lowerName, "vision") || strings.Contains(lowerName, "llava") {
		capabilities = append(capabilities, llm.CapabilityVision)
	}

	// Check for embedding models
	if strings.Contains(lowerName, "embed") || strings.Contains(lowerName, "nomic") {
		capabilities = append(capabilities, llm.CapabilityEmbed)
	}

	// Tool support is common in newer models
	if resp.ModelInfo != nil {
		if _, ok := resp.ModelInfo["tool_support"]; ok {
			capabilities = append(capabilities, llm.CapabilityTools)
		}
	}

	details.Capabilities = capabilities

	return details
}
