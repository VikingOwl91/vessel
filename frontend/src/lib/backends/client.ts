/**
 * Abstract backend client interface.
 * All LLM backend implementations must implement this interface,
 * enabling the frontend to work uniformly with any backend.
 */

import type {
	BackendType,
	Capability,
	ChatRequest,
	ChatResponse,
	ChatStreamChunk,
	ModelInfo,
	ModelDetails,
	BackendStatus,
	PullProgress,
	EmbedRequest,
	EmbedResponse,
	StreamCallbacks,
	StreamResult,
	BackendError
} from './types.js';

// ============================================================================
// Core Backend Interface
// ============================================================================

/**
 * Core interface that all LLM backends must implement.
 * Provides basic functionality for model interaction and management.
 */
export interface BackendClient {
	/** Unique identifier for this backend instance */
	readonly id: string;

	/** Backend type identifier */
	readonly type: BackendType;

	/** Human-readable name for display */
	readonly name: string;

	/** Features this backend supports */
	readonly capabilities: Capability[];

	/**
	 * Check if the backend is available and responsive.
	 * @param signal Optional abort signal
	 * @returns true if the backend is reachable
	 */
	ping(signal?: AbortSignal): Promise<boolean>;

	/**
	 * Check if the backend supports a specific capability.
	 */
	hasCapability(cap: Capability): boolean;

	/**
	 * Perform a chat completion request.
	 * @param request Chat request parameters
	 * @param signal Optional abort signal
	 * @returns Chat response
	 */
	chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;

	/**
	 * Perform a streaming chat completion.
	 * @param request Chat request parameters
	 * @param signal Optional abort signal
	 * @yields ChatStreamChunk for each token
	 * @returns StreamResult with accumulated content
	 */
	streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatStreamChunk, StreamResult, unknown>;

	/**
	 * Perform a streaming chat with callbacks.
	 * More ergonomic for UI integrations.
	 * @param request Chat request parameters
	 * @param callbacks Streaming callbacks
	 * @param signal Optional abort signal
	 * @returns StreamResult when complete
	 */
	streamChatWithCallbacks(
		request: ChatRequest,
		callbacks: StreamCallbacks,
		signal?: AbortSignal
	): Promise<StreamResult>;

	/**
	 * Cancel any in-progress generation.
	 * This should work reliably - either via API call or process termination.
	 */
	cancel(): Promise<void>;

	/**
	 * Get the current backend status including performance metrics.
	 * @param signal Optional abort signal
	 */
	status(signal?: AbortSignal): Promise<BackendStatus>;

	/**
	 * List all available models from this backend.
	 * @param signal Optional abort signal
	 */
	listModels(signal?: AbortSignal): Promise<ModelInfo[]>;

	/**
	 * Get detailed information about a specific model.
	 * @param name Model name/identifier
	 * @param signal Optional abort signal
	 */
	showModel(name: string, signal?: AbortSignal): Promise<ModelDetails>;

	/**
	 * Release any resources held by the backend.
	 * Called when the backend is no longer needed.
	 */
	dispose(): void;
}

// ============================================================================
// Optional Capability Interfaces
// ============================================================================

/**
 * Interface for backends that support model downloading.
 */
export interface PullableBackend extends BackendClient {
	/**
	 * Download a model from the backend's registry.
	 * @param name Model name to pull
	 * @param onProgress Progress callback
	 * @param signal Optional abort signal
	 */
	pullModel(
		name: string,
		onProgress: (progress: PullProgress) => void,
		signal?: AbortSignal
	): Promise<void>;
}

/**
 * Interface for backends that support model deletion.
 */
export interface DeletableBackend extends BackendClient {
	/**
	 * Delete a model from local storage.
	 * @param name Model name to delete
	 * @param signal Optional abort signal
	 */
	deleteModel(name: string, signal?: AbortSignal): Promise<void>;
}

/**
 * Interface for backends that support custom model creation.
 */
export interface CreatableBackend extends BackendClient {
	/**
	 * Create a custom model with an embedded system prompt.
	 * @param name New model name
	 * @param baseModel Base model to derive from
	 * @param systemPrompt System prompt to embed
	 * @param onProgress Progress callback
	 * @param signal Optional abort signal
	 */
	createModel(
		name: string,
		baseModel: string,
		systemPrompt: string,
		onProgress: (progress: PullProgress) => void,
		signal?: AbortSignal
	): Promise<void>;
}

/**
 * Interface for backends that support model copying.
 */
export interface CopyableBackend extends BackendClient {
	/**
	 * Create a copy of an existing model with a new name.
	 * @param source Source model name
	 * @param destination New model name
	 * @param signal Optional abort signal
	 */
	copyModel(source: string, destination: string, signal?: AbortSignal): Promise<void>;
}

/**
 * Interface for backends that support embeddings.
 */
export interface EmbeddableBackend extends BackendClient {
	/**
	 * Generate embeddings for text.
	 * @param request Embed request
	 * @param signal Optional abort signal
	 */
	embed(request: EmbedRequest, signal?: AbortSignal): Promise<EmbedResponse>;
}

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a backend supports pulling models */
export function isPullable(backend: BackendClient): backend is PullableBackend {
	return backend.hasCapability('pull') && 'pullModel' in backend;
}

/** Check if a backend supports deleting models */
export function isDeletable(backend: BackendClient): backend is DeletableBackend {
	return backend.hasCapability('delete') && 'deleteModel' in backend;
}

/** Check if a backend supports creating custom models */
export function isCreatable(backend: BackendClient): backend is CreatableBackend {
	return backend.hasCapability('create') && 'createModel' in backend;
}

/** Check if a backend supports copying models */
export function isCopyable(backend: BackendClient): backend is CopyableBackend {
	return 'copyModel' in backend;
}

/** Check if a backend supports embeddings */
export function isEmbeddable(backend: BackendClient): backend is EmbeddableBackend {
	return backend.hasCapability('embed') && 'embed' in backend;
}

// ============================================================================
// Error Helpers
// ============================================================================

/**
 * Create a standardized BackendError from any error.
 */
export function createBackendError(
	error: unknown,
	category: BackendError['category'] = 'unknown'
): BackendError {
	if (error instanceof Error) {
		// Check for abort
		if (error.name === 'AbortError') {
			return {
				code: 'CANCELLED',
				message: 'Request was cancelled',
				category: 'cancelled',
				retryable: false
			};
		}

		return {
			code: 'ERROR',
			message: error.message,
			category,
			retryable: category === 'network' || category === 'rate_limit'
		};
	}

	return {
		code: 'UNKNOWN',
		message: String(error),
		category: 'unknown',
		retryable: false
	};
}
