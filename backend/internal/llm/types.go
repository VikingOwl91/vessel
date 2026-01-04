// Package llm provides a unified abstraction layer for multiple LLM backends.
// It defines common types, interfaces, and error handling for interacting with
// various LLM providers including Ollama, llama.cpp, and HuggingFace.
package llm

import (
	"time"
)

// BackendType identifies the type of LLM backend.
type BackendType string

const (
	// BackendOllama represents the Ollama backend.
	BackendOllama BackendType = "ollama"
	// BackendLlamaCppServer represents llama.cpp running in server mode.
	BackendLlamaCppServer BackendType = "llama-cpp-server"
	// BackendLlamaCppNative represents native llama.cpp integration.
	BackendLlamaCppNative BackendType = "llama-cpp-native"
	// BackendHuggingFace represents HuggingFace inference endpoints.
	BackendHuggingFace BackendType = "huggingface"
	// BackendVLM represents VLM (Vessel Llama Manager) - managed llama.cpp.
	BackendVLM BackendType = "vlm"
)

// Capability represents a feature supported by a backend.
type Capability string

const (
	// CapabilityChat indicates support for chat completions.
	CapabilityChat Capability = "chat"
	// CapabilityGenerate indicates support for text generation.
	CapabilityGenerate Capability = "generate"
	// CapabilityEmbed indicates support for embeddings.
	CapabilityEmbed Capability = "embed"
	// CapabilityVision indicates support for vision/image inputs.
	CapabilityVision Capability = "vision"
	// CapabilityTools indicates support for tool/function calling.
	CapabilityTools Capability = "tools"
	// CapabilityPull indicates support for pulling/downloading models.
	CapabilityPull Capability = "pull"
	// CapabilityDelete indicates support for deleting models.
	CapabilityDelete Capability = "delete"
	// CapabilityCreate indicates support for creating custom models.
	CapabilityCreate Capability = "create"
	// CapabilityStreaming indicates support for streaming responses.
	CapabilityStreaming Capability = "streaming"
)

// Message represents a chat message in a conversation.
type Message struct {
	// Role identifies the message author: "system", "user", "assistant", or "tool".
	Role string `json:"role"`
	// Content is the text content of the message.
	Content string `json:"content"`
	// Images contains base64-encoded image data for vision models.
	Images []string `json:"images,omitempty"`
	// ToolCalls contains tool invocations requested by the assistant.
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
	// ToolCallID identifies the tool call this message is responding to.
	ToolCallID string `json:"tool_call_id,omitempty"`
}

// ToolCall represents a tool invocation requested by the model.
type ToolCall struct {
	// ID is a unique identifier for this tool call.
	ID string `json:"id"`
	// Type is the type of tool call, typically "function".
	Type string `json:"type"`
	// Function contains the function call details.
	Function ToolFunction `json:"function"`
}

// ToolFunction contains the details of a function call.
type ToolFunction struct {
	// Name is the name of the function to call.
	Name string `json:"name"`
	// Arguments contains the function arguments as a JSON string.
	Arguments string `json:"arguments"`
}

// Tool represents a tool available for the model to use.
type Tool struct {
	// Type is the type of tool, typically "function".
	Type string `json:"type"`
	// Function contains the function specification.
	Function ToolSpec `json:"function"`
}

// ToolSpec defines a function that the model can call.
type ToolSpec struct {
	// Name is the name of the function.
	Name string `json:"name"`
	// Description explains what the function does.
	Description string `json:"description"`
	// Parameters is a JSON Schema object describing the function parameters.
	Parameters map[string]any `json:"parameters,omitempty"`
}

// ChatRequest contains parameters for a chat completion request.
type ChatRequest struct {
	// Model is the name of the model to use.
	Model string `json:"model"`
	// Messages is the conversation history.
	Messages []Message `json:"messages"`
	// Stream enables streaming responses when true.
	Stream bool `json:"stream"`
	// Temperature controls randomness (0.0-2.0, default varies by backend).
	Temperature *float64 `json:"temperature,omitempty"`
	// TopP controls nucleus sampling (0.0-1.0).
	TopP *float64 `json:"top_p,omitempty"`
	// TopK limits token selection to top K options.
	TopK *int `json:"top_k,omitempty"`
	// MaxTokens limits the response length.
	MaxTokens *int `json:"max_tokens,omitempty"`
	// StopWords are sequences that stop generation.
	StopWords []string `json:"stop,omitempty"`
	// Tools are functions available for the model to call.
	Tools []Tool `json:"tools,omitempty"`
	// Format specifies the output format (e.g., "json").
	Format string `json:"format,omitempty"`
	// Options contains backend-specific options.
	Options map[string]any `json:"options,omitempty"`
}

// ChatResponse contains the result of a chat completion.
type ChatResponse struct {
	// Model is the name of the model that generated the response.
	Model string `json:"model"`
	// Message is the assistant's response.
	Message Message `json:"message"`
	// Done indicates whether generation is complete.
	Done bool `json:"done"`
	// DoneReason explains why generation stopped (e.g., "stop", "length").
	DoneReason string `json:"done_reason,omitempty"`
	// PromptTokens is the number of tokens in the prompt.
	PromptTokens int `json:"prompt_eval_count,omitempty"`
	// ResponseTokens is the number of tokens in the response.
	ResponseTokens int `json:"eval_count,omitempty"`
	// TotalDuration is the total processing time in nanoseconds.
	TotalDuration time.Duration `json:"total_duration,omitempty"`
	// LoadDuration is the model loading time in nanoseconds.
	LoadDuration time.Duration `json:"load_duration,omitempty"`
	// PromptEvalDuration is the prompt evaluation time in nanoseconds.
	PromptEvalDuration time.Duration `json:"prompt_eval_duration,omitempty"`
	// EvalDuration is the response generation time in nanoseconds.
	EvalDuration time.Duration `json:"eval_duration,omitempty"`
	// Metrics contains performance metrics for this generation.
	Metrics *GenerationMetrics `json:"metrics,omitempty"`
}

// StreamCallback is called for each chunk during streaming responses.
type StreamCallback func(response ChatResponse) error

// ModelInfo contains basic information about a model.
type ModelInfo struct {
	// Name is the model identifier.
	Name string `json:"name"`
	// ModifiedAt is when the model was last modified.
	ModifiedAt time.Time `json:"modified_at"`
	// Size is the model size in bytes.
	Size int64 `json:"size"`
	// Digest is the model's content hash.
	Digest string `json:"digest"`
	// Family is the model architecture family (e.g., "llama", "mistral").
	Family string `json:"family,omitempty"`
	// ParameterSize is the model size (e.g., "7B", "13B").
	ParameterSize string `json:"parameter_size,omitempty"`
	// QuantLevel is the quantization level (e.g., "Q4_K_M").
	QuantLevel string `json:"quantization_level,omitempty"`
	// ContextLength is the maximum context window size.
	ContextLength int `json:"context_length,omitempty"`
	// Capabilities lists features the model supports.
	Capabilities []Capability `json:"capabilities,omitempty"`
	// Extra contains backend-specific metadata.
	Extra map[string]any `json:"extra,omitempty"`
}

// ModelDetails extends ModelInfo with additional configuration details.
type ModelDetails struct {
	ModelInfo
	// License is the model's license information.
	License string `json:"license,omitempty"`
	// Modelfile is the Ollama Modelfile content (if applicable).
	Modelfile string `json:"modelfile,omitempty"`
	// Parameters are the model's default parameters.
	Parameters string `json:"parameters,omitempty"`
	// Template is the chat template format.
	Template string `json:"template,omitempty"`
	// SystemPrompt is the default system prompt embedded in the model.
	SystemPrompt string `json:"system,omitempty"`
}

// PullProgress reports the progress of a model download.
type PullProgress struct {
	// Status describes the current operation (e.g., "downloading", "verifying").
	Status string `json:"status"`
	// Digest is the layer being processed.
	Digest string `json:"digest,omitempty"`
	// Total is the total size in bytes.
	Total int64 `json:"total,omitempty"`
	// Completed is the number of bytes completed.
	Completed int64 `json:"completed,omitempty"`
}

// PullCallback is called for each progress update during model downloads.
type PullCallback func(progress PullProgress) error

// EmbedRequest contains parameters for an embedding request.
type EmbedRequest struct {
	// Model is the name of the embedding model.
	Model string `json:"model"`
	// Input is the text or texts to embed.
	Input []string `json:"input"`
	// Options contains backend-specific options.
	Options map[string]any `json:"options,omitempty"`
}

// EmbedResponse contains the result of an embedding request.
type EmbedResponse struct {
	// Model is the name of the model that generated the embeddings.
	Model string `json:"model"`
	// Embeddings is the list of embedding vectors.
	Embeddings [][]float64 `json:"embeddings"`
	// PromptTokens is the total number of tokens processed.
	PromptTokens int `json:"prompt_eval_count,omitempty"`
}

// GenerationMetrics contains performance metrics for a generation.
type GenerationMetrics struct {
	// PromptTokensPerSec is the prompt processing speed.
	PromptTokensPerSec float64 `json:"prompt_tps"`
	// DecodeTokensPerSec is the token generation speed.
	DecodeTokensPerSec float64 `json:"decode_tps"`
	// AvgTokensPerSec is the rolling average over recent tokens.
	AvgTokensPerSec float64 `json:"avg_tps,omitempty"`
	// ContextUsed is the number of context tokens used.
	ContextUsed int `json:"context_used"`
	// ContextMax is the maximum context size.
	ContextMax int `json:"context_max"`
	// KVCachePercent is the KV cache utilization (0-100).
	KVCachePercent float64 `json:"kv_cache_percent,omitempty"`
	// BatchSize is the current batch size.
	BatchSize int `json:"batch_size,omitempty"`
}

// BackendStatus represents the current state of a backend.
type BackendStatus struct {
	// Available indicates if the backend is reachable.
	Available bool `json:"available"`
	// LoadedModel is the currently loaded model (if any).
	LoadedModel string `json:"loaded_model,omitempty"`
	// Version is the backend software version.
	Version string `json:"version,omitempty"`
	// GPUMemoryUsed is GPU memory usage in bytes.
	GPUMemoryUsed int64 `json:"gpu_memory_used,omitempty"`
	// GPUMemoryTotal is total GPU memory in bytes.
	GPUMemoryTotal int64 `json:"gpu_memory_total,omitempty"`
	// QueueDepth is the number of pending requests.
	QueueDepth int `json:"queue_depth,omitempty"`
	// CurrentMetrics is the metrics from the current/last generation.
	CurrentMetrics *GenerationMetrics `json:"current_metrics,omitempty"`
}

// ChatTemplate defines how to format messages for a specific model.
// This is centralized to prevent each backend from implementing its own formatting.
type ChatTemplate struct {
	// Name is the template identifier.
	Name string `json:"name"`
	// Template is the Jinja2 or Go template string.
	Template string `json:"template"`
	// StopSequences are tokens that signal end of generation.
	StopSequences []string `json:"stop_sequences"`
	// BosToken is the beginning-of-sequence token.
	BosToken string `json:"bos_token,omitempty"`
	// EosToken is the end-of-sequence token.
	EosToken string `json:"eos_token,omitempty"`
	// SystemFormat defines how to inject system prompts.
	SystemFormat string `json:"system_format,omitempty"`
	// AddGenerationPrompt adds assistant prefix when true.
	AddGenerationPrompt bool `json:"add_generation_prompt"`
}
