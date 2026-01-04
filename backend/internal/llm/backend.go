package llm

import (
	"context"
)

// Backend defines the core interface that all LLM backends must implement.
// It provides basic functionality for model interaction and management.
type Backend interface {
	// Name returns the unique identifier for this backend instance.
	Name() string

	// Type returns the backend type identifier.
	Type() BackendType

	// Ping checks if the backend is available and responsive.
	Ping(ctx context.Context) error

	// Available checks if the backend is currently reachable.
	// This is a convenience wrapper that returns true if Ping succeeds.
	Available(ctx context.Context) bool

	// Capabilities returns the list of features this backend supports.
	Capabilities() []Capability

	// HasCapability checks if the backend supports a specific capability.
	HasCapability(cap Capability) bool

	// Chat performs a chat completion request.
	// If req.Stream is true and callback is non-nil, streams chunks via callback.
	// Returns the final response or an error.
	Chat(ctx context.Context, req *ChatRequest, callback StreamCallback) (*ChatResponse, error)

	// Cancel aborts any in-progress generation for this backend.
	// This should work reliably - either via API call or process termination.
	Cancel(ctx context.Context) error

	// Status returns the current backend status including performance metrics.
	Status(ctx context.Context) (*BackendStatus, error)

	// ListModels returns all available models from this backend.
	ListModels(ctx context.Context) ([]ModelInfo, error)

	// ShowModel returns detailed information about a specific model.
	ShowModel(ctx context.Context, name string) (*ModelDetails, error)

	// Close releases any resources held by the backend.
	Close() error
}

// PullableBackend extends Backend with model download capabilities.
// Backends that support pulling models from registries implement this interface.
type PullableBackend interface {
	Backend

	// PullModel downloads a model from the backend's registry.
	// Progress is reported via the callback.
	PullModel(ctx context.Context, name string, callback PullCallback) error
}

// DeletableBackend extends Backend with model deletion capabilities.
type DeletableBackend interface {
	Backend

	// DeleteModel removes a model from the backend.
	DeleteModel(ctx context.Context, name string) error
}

// CreatableBackend extends Backend with custom model creation capabilities.
// This is primarily used by Ollama for creating models with custom system prompts.
type CreatableBackend interface {
	Backend

	// CreateModel creates a new model from a modelfile or base model.
	// The modelfile parameter contains the model definition.
	// Progress is reported via the callback.
	CreateModel(ctx context.Context, name, modelfile string, callback PullCallback) error
}

// CopyableBackend extends Backend with model copying capabilities.
type CopyableBackend interface {
	Backend

	// CopyModel creates a copy of an existing model with a new name.
	CopyModel(ctx context.Context, source, destination string) error
}

// EmbeddableBackend extends Backend with embedding generation capabilities.
type EmbeddableBackend interface {
	Backend

	// Embed generates embeddings for the given input texts.
	Embed(ctx context.Context, req *EmbedRequest) (*EmbedResponse, error)
}
