package backends

import (
	"context"
)

// LLMBackend defines the interface for LLM backend implementations.
// All backends (Ollama, llama.cpp, LM Studio) must implement this interface.
type LLMBackend interface {
	// Type returns the backend type identifier
	Type() BackendType

	// Config returns the backend configuration
	Config() BackendConfig

	// HealthCheck verifies the backend is reachable and operational
	HealthCheck(ctx context.Context) error

	// ListModels returns all models available from this backend
	ListModels(ctx context.Context) ([]Model, error)

	// StreamChat sends a chat request and returns a channel for streaming responses.
	// The channel is closed when the stream completes or an error occurs.
	// Callers should check ChatChunk.Error for stream errors.
	StreamChat(ctx context.Context, req *ChatRequest) (<-chan ChatChunk, error)

	// Chat sends a non-streaming chat request and returns the final response
	Chat(ctx context.Context, req *ChatRequest) (*ChatChunk, error)

	// Capabilities returns what features this backend supports
	Capabilities() BackendCapabilities

	// Info returns detailed information about the backend including status
	Info(ctx context.Context) BackendInfo
}

// ModelManager extends LLMBackend with model management capabilities.
// Only Ollama implements this interface.
type ModelManager interface {
	LLMBackend

	// PullModel downloads a model from the registry.
	// Returns a channel for progress updates.
	PullModel(ctx context.Context, name string) (<-chan PullProgress, error)

	// DeleteModel removes a model from local storage
	DeleteModel(ctx context.Context, name string) error

	// CreateModel creates a custom model with the given Modelfile content
	CreateModel(ctx context.Context, name string, modelfile string) (<-chan CreateProgress, error)

	// CopyModel creates a copy of an existing model
	CopyModel(ctx context.Context, source, destination string) error

	// ShowModel returns detailed information about a specific model
	ShowModel(ctx context.Context, name string) (*ModelDetails, error)
}

// EmbeddingProvider extends LLMBackend with embedding capabilities.
type EmbeddingProvider interface {
	LLMBackend

	// Embed generates embeddings for the given input
	Embed(ctx context.Context, model string, input []string) ([][]float64, error)
}

// PullProgress represents progress during model download
type PullProgress struct {
	Status    string `json:"status"`
	Digest    string `json:"digest,omitempty"`
	Total     int64  `json:"total,omitempty"`
	Completed int64  `json:"completed,omitempty"`
	Error     string `json:"error,omitempty"`
}

// CreateProgress represents progress during model creation
type CreateProgress struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// ModelDetails contains detailed information about a model
type ModelDetails struct {
	Name       string            `json:"name"`
	ModifiedAt string            `json:"modified_at"`
	Size       int64             `json:"size"`
	Digest     string            `json:"digest"`
	Format     string            `json:"format"`
	Family     string            `json:"family"`
	Families   []string          `json:"families"`
	ParamSize  string            `json:"parameter_size"`
	QuantLevel string            `json:"quantization_level"`
	Template   string            `json:"template"`
	System     string            `json:"system"`
	License    string            `json:"license"`
	Modelfile  string            `json:"modelfile"`
	Parameters map[string]string `json:"parameters"`
}
