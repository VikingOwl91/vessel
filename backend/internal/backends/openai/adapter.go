package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"vessel-backend/internal/backends"
)

// Adapter implements the LLMBackend interface for OpenAI-compatible APIs.
// This includes llama.cpp server and LM Studio.
type Adapter struct {
	config     backends.BackendConfig
	httpClient *http.Client
	baseURL    *url.URL
}

// Ensure Adapter implements required interfaces
var (
	_ backends.LLMBackend        = (*Adapter)(nil)
	_ backends.EmbeddingProvider = (*Adapter)(nil)
)

// NewAdapter creates a new OpenAI-compatible backend adapter
func NewAdapter(config backends.BackendConfig) (*Adapter, error) {
	if config.Type != backends.BackendTypeLlamaCpp && config.Type != backends.BackendTypeLMStudio {
		return nil, fmt.Errorf("invalid backend type: expected %s or %s, got %s",
			backends.BackendTypeLlamaCpp, backends.BackendTypeLMStudio, config.Type)
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
	return a.config.Type
}

// Config returns the backend configuration
func (a *Adapter) Config() backends.BackendConfig {
	return a.config
}

// Capabilities returns what features this backend supports
func (a *Adapter) Capabilities() backends.BackendCapabilities {
	if a.config.Type == backends.BackendTypeLlamaCpp {
		return backends.LlamaCppCapabilities()
	}
	return backends.LMStudioCapabilities()
}

// HealthCheck verifies the backend is reachable
func (a *Adapter) HealthCheck(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", a.baseURL.String()+"/v1/models", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach backend: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("backend returned status %d", resp.StatusCode)
	}

	return nil
}

// openaiModelsResponse represents the response from /v1/models
type openaiModelsResponse struct {
	Data []openaiModel `json:"data"`
}

type openaiModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	OwnedBy string `json:"owned_by"`
	Created int64  `json:"created"`
}

// ListModels returns all models available from this backend
func (a *Adapter) ListModels(ctx context.Context) ([]backends.Model, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", a.baseURL.String()+"/v1/models", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to list models: %w", err)
	}
	defer resp.Body.Close()

	var listResp openaiModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	models := make([]backends.Model, len(listResp.Data))
	for i, m := range listResp.Data {
		models[i] = backends.Model{
			ID:   m.ID,
			Name: m.ID,
		}
	}

	return models, nil
}

// Chat sends a non-streaming chat request
func (a *Adapter) Chat(ctx context.Context, req *backends.ChatRequest) (*backends.ChatChunk, error) {
	if err := req.Validate(); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	openaiReq := a.convertChatRequest(req)
	openaiReq["stream"] = false

	body, err := json.Marshal(openaiReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("chat request failed: %w", err)
	}
	defer resp.Body.Close()

	var openaiResp openaiChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&openaiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return a.convertChatResponse(&openaiResp), nil
}

// StreamChat sends a streaming chat request
func (a *Adapter) StreamChat(ctx context.Context, req *backends.ChatRequest) (<-chan backends.ChatChunk, error) {
	if err := req.Validate(); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	openaiReq := a.convertChatRequest(req)
	openaiReq["stream"] = true

	body, err := json.Marshal(openaiReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

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

		a.parseSSEStream(ctx, resp.Body, chunkCh)
	}()

	return chunkCh, nil
}

// parseSSEStream parses Server-Sent Events and emits ChatChunks
func (a *Adapter) parseSSEStream(ctx context.Context, body io.Reader, chunkCh chan<- backends.ChatChunk) {
	scanner := bufio.NewScanner(body)

	// Track accumulated tool call arguments
	toolCallArgs := make(map[int]string)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}

		line := scanner.Text()

		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}

		// Parse SSE data line
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")

		// Check for stream end
		if data == "[DONE]" {
			chunkCh <- backends.ChatChunk{Done: true}
			return
		}

		var streamResp openaiStreamResponse
		if err := json.Unmarshal([]byte(data), &streamResp); err != nil {
			chunkCh <- backends.ChatChunk{Error: fmt.Sprintf("failed to parse SSE data: %v", err)}
			continue
		}

		chunk := a.convertStreamResponse(&streamResp, toolCallArgs)
		chunkCh <- chunk

		if chunk.Done {
			return
		}
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		chunkCh <- backends.ChatChunk{Error: fmt.Sprintf("stream error: %v", err)}
	}
}

// Info returns detailed information about the backend
func (a *Adapter) Info(ctx context.Context) backends.BackendInfo {
	info := backends.BackendInfo{
		Type:         a.config.Type,
		BaseURL:      a.config.BaseURL,
		Capabilities: a.Capabilities(),
	}

	// Try to reach the models endpoint
	if err := a.HealthCheck(ctx); err != nil {
		info.Status = backends.BackendStatusDisconnected
		info.Error = err.Error()
		return info
	}

	info.Status = backends.BackendStatusConnected
	return info
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

	req, err := http.NewRequestWithContext(ctx, "POST", a.baseURL.String()+"/v1/embeddings", bytes.NewReader(body))
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
		Data []struct {
			Embedding []float64 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&embedResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	embeddings := make([][]float64, len(embedResp.Data))
	for _, d := range embedResp.Data {
		embeddings[d.Index] = d.Embedding
	}

	return embeddings, nil
}

// OpenAI API response types

type openaiChatResponse struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []openaiChoice `json:"choices"`
	Usage   *openaiUsage   `json:"usage,omitempty"`
}

type openaiChoice struct {
	Index        int            `json:"index"`
	Message      *openaiMessage `json:"message,omitempty"`
	Delta        *openaiMessage `json:"delta,omitempty"`
	FinishReason string         `json:"finish_reason,omitempty"`
}

type openaiMessage struct {
	Role      string           `json:"role,omitempty"`
	Content   string           `json:"content,omitempty"`
	ToolCalls []openaiToolCall `json:"tool_calls,omitempty"`
}

type openaiToolCall struct {
	ID       string `json:"id,omitempty"`
	Index    int    `json:"index,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function"`
}

type openaiUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type openaiStreamResponse struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []openaiChoice `json:"choices"`
}

// convertChatRequest converts a backends.ChatRequest to OpenAI format
func (a *Adapter) convertChatRequest(req *backends.ChatRequest) map[string]interface{} {
	messages := make([]map[string]interface{}, len(req.Messages))
	for i, msg := range req.Messages {
		m := map[string]interface{}{
			"role": msg.Role,
		}

		// Handle messages with images (vision support)
		if len(msg.Images) > 0 {
			// Build content as array of parts for multimodal messages
			contentParts := make([]map[string]interface{}, 0, len(msg.Images)+1)

			// Add text part if content is not empty
			if msg.Content != "" {
				contentParts = append(contentParts, map[string]interface{}{
					"type": "text",
					"text": msg.Content,
				})
			}

			// Add image parts
			for _, img := range msg.Images {
				// Images are expected as base64 data URLs or URLs
				imageURL := img
				if !strings.HasPrefix(img, "http://") && !strings.HasPrefix(img, "https://") && !strings.HasPrefix(img, "data:") {
					// Assume base64 encoded image, default to JPEG
					imageURL = "data:image/jpeg;base64," + img
				}
				contentParts = append(contentParts, map[string]interface{}{
					"type": "image_url",
					"image_url": map[string]interface{}{
						"url": imageURL,
					},
				})
			}

			m["content"] = contentParts
		} else {
			// Plain text message
			m["content"] = msg.Content
		}

		if msg.Name != "" {
			m["name"] = msg.Name
		}
		if msg.ToolCallID != "" {
			m["tool_call_id"] = msg.ToolCallID
		}
		messages[i] = m
	}

	openaiReq := map[string]interface{}{
		"model":    req.Model,
		"messages": messages,
	}

	// Add optional parameters
	if req.Temperature != nil {
		openaiReq["temperature"] = *req.Temperature
	}
	if req.TopP != nil {
		openaiReq["top_p"] = *req.TopP
	}
	if req.MaxTokens != nil {
		openaiReq["max_tokens"] = *req.MaxTokens
	}
	if len(req.Tools) > 0 {
		openaiReq["tools"] = req.Tools
	}

	return openaiReq
}

// convertChatResponse converts an OpenAI response to backends.ChatChunk
func (a *Adapter) convertChatResponse(resp *openaiChatResponse) *backends.ChatChunk {
	chunk := &backends.ChatChunk{
		Model: resp.Model,
		Done:  true,
	}

	if len(resp.Choices) > 0 {
		choice := resp.Choices[0]
		if choice.Message != nil {
			msg := &backends.ChatMessage{
				Role:    choice.Message.Role,
				Content: choice.Message.Content,
			}

			// Convert tool calls
			for _, tc := range choice.Message.ToolCalls {
				msg.ToolCalls = append(msg.ToolCalls, backends.ToolCall{
					ID:   tc.ID,
					Type: tc.Type,
					Function: struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					}{
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					},
				})
			}

			chunk.Message = msg
		}

		if choice.FinishReason != "" {
			chunk.DoneReason = choice.FinishReason
		}
	}

	if resp.Usage != nil {
		chunk.PromptEvalCount = resp.Usage.PromptTokens
		chunk.EvalCount = resp.Usage.CompletionTokens
	}

	return chunk
}

// convertStreamResponse converts an OpenAI stream response to backends.ChatChunk
func (a *Adapter) convertStreamResponse(resp *openaiStreamResponse, toolCallArgs map[int]string) backends.ChatChunk {
	chunk := backends.ChatChunk{
		Model: resp.Model,
	}

	if len(resp.Choices) > 0 {
		choice := resp.Choices[0]

		if choice.FinishReason != "" {
			chunk.Done = true
			chunk.DoneReason = choice.FinishReason
		}

		if choice.Delta != nil {
			msg := &backends.ChatMessage{
				Role:    choice.Delta.Role,
				Content: choice.Delta.Content,
			}

			// Handle streaming tool calls
			for _, tc := range choice.Delta.ToolCalls {
				// Accumulate arguments
				if tc.Function.Arguments != "" {
					toolCallArgs[tc.Index] += tc.Function.Arguments
				}

				// Only add tool call when we have the initial info
				if tc.ID != "" || tc.Function.Name != "" {
					msg.ToolCalls = append(msg.ToolCalls, backends.ToolCall{
						ID:   tc.ID,
						Type: tc.Type,
						Function: struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						}{
							Name:      tc.Function.Name,
							Arguments: toolCallArgs[tc.Index],
						},
					})
				}
			}

			chunk.Message = msg
		}
	}

	return chunk
}
