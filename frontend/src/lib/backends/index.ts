/**
 * Backend abstraction layer exports.
 * Provides a unified interface for working with multiple LLM backends.
 */

// Types
export type {
	BackendType,
	Capability,
	MessageRole,
	Message,
	ToolCall,
	ToolCallFunction,
	Tool,
	ToolFunction,
	ToolParameters,
	ToolParameterProperty,
	GenerationOptions,
	ChatRequest,
	ChatResponse,
	ChatStreamChunk,
	GenerationMetrics,
	ModelInfo,
	ModelDetails,
	PullProgress,
	EmbedRequest,
	EmbedResponse,
	BackendStatus,
	BackendConfig,
	ErrorCategory,
	BackendError,
	StreamCallbacks,
	StreamResult,
	ChatTemplate
} from './types.js';

// Type guards
export { isBackendError, isRetryableCategory } from './types.js';

// Client interface
export type {
	BackendClient,
	PullableBackend,
	DeletableBackend,
	CreatableBackend,
	CopyableBackend,
	EmbeddableBackend
} from './client.js';

// Client utilities
export {
	isPullable,
	isDeletable,
	isCreatable,
	isCopyable,
	isEmbeddable,
	createBackendError
} from './client.js';

// Ollama backend
export { OllamaBackendAdapter, createOllamaBackend } from './ollama/index.js';

// llama.cpp server backend
export { LlamaCppBackendAdapter, createLlamaCppBackend, type LlamaCppOptions } from './llamacpp/index.js';
