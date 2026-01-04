package backends

import (
	"fmt"

	"vessel-backend/internal/llm"
)

// DefaultFactory is the standard backend factory implementation.
// It creates Backend instances based on configuration type.
type DefaultFactory struct{}

// NewDefaultFactory creates a new DefaultFactory.
func NewDefaultFactory() *DefaultFactory {
	return &DefaultFactory{}
}

// Create creates a Backend instance based on the configuration type.
func (f *DefaultFactory) Create(cfg *llm.BackendConfig) (llm.Backend, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	switch cfg.Type {
	case llm.BackendOllama:
		return NewOllamaBackend(cfg)

	case llm.BackendLlamaCppServer:
		return NewLlamaCppServerBackendFromConfig(cfg)

	case llm.BackendVLM:
		return NewVLMBackendFromConfig(cfg)

	case llm.BackendLlamaCppNative:
		// TODO: Implement llama.cpp native backend
		return nil, fmt.Errorf("llama-cpp-native backend not yet implemented")

	case llm.BackendHuggingFace:
		// TODO: Implement HuggingFace backend
		return nil, fmt.Errorf("huggingface backend not yet implemented")

	default:
		return nil, fmt.Errorf("unknown backend type: %s", cfg.Type)
	}
}
