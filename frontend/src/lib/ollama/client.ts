/**
 * Ollama API Client
 * Provides a high-level interface for interacting with the Ollama API
 */

import type {
	OllamaModelsResponse,
	OllamaRunningModelsResponse,
	OllamaChatRequest,
	OllamaChatResponse,
	OllamaChatStreamChunk,
	OllamaMessage,
	OllamaModelOptions,
	OllamaToolDefinition,
	OllamaShowRequest,
	OllamaShowResponse,
	OllamaVersionResponse,
	OllamaEmbedRequest,
	OllamaEmbedResponse,
	OllamaGenerateRequest,
	OllamaGenerateResponse,
	JsonSchema
} from './types.js';
import {
	OllamaConnectionError,
	classifyError,
	createErrorFromResponse,
	withRetry,
	type RetryOptions
} from './errors.js';
import {
	streamChat,
	streamChatWithCallbacks,
	type StreamChatOptions,
	type StreamChatResult,
	type StreamChatCallbacks
} from './streaming.js';

// ============================================================================
// Configuration
// ============================================================================

/** Configuration options for OllamaClient */
export interface OllamaClientConfig {
	/** Base URL for Ollama API (default: http://localhost:11434) */
	baseUrl?: string;
	/** Default timeout for requests in milliseconds (default: 120000) */
	defaultTimeoutMs?: number;
	/** Enable automatic retries for transient errors (default: true) */
	enableRetry?: boolean;
	/** Retry configuration */
	retryOptions?: RetryOptions;
	/** Custom fetch implementation (for testing) */
	fetchFn?: typeof fetch;
}

/** Default configuration values */
const DEFAULT_CONFIG: Required<Omit<OllamaClientConfig, 'fetchFn' | 'retryOptions'>> = {
	// Use proxied path (vite.config.ts proxies /api to Ollama)
	// This avoids CORS issues when running in development
	baseUrl: '',
	defaultTimeoutMs: 120000,
	enableRetry: true
};

// ============================================================================
// Client Class
// ============================================================================

/**
 * Client for interacting with the Ollama API
 */
export class OllamaClient {
	private readonly config: Required<Omit<OllamaClientConfig, 'fetchFn' | 'retryOptions'>>;
	private readonly retryOptions?: RetryOptions;
	private readonly fetchFn: typeof fetch;

	constructor(config: OllamaClientConfig = {}) {
		this.config = {
			...DEFAULT_CONFIG,
			...config
		};
		this.retryOptions = config.retryOptions;
		this.fetchFn = config.fetchFn ?? fetch;
	}

	// ==========================================================================
	// Model Management
	// ==========================================================================

	/**
	 * Lists all locally available models
	 * GET /api/tags
	 */
	async listModels(signal?: AbortSignal): Promise<OllamaModelsResponse> {
		return this.request<OllamaModelsResponse>('/api/tags', {
			method: 'GET',
			signal
		});
	}

	/**
	 * Lists all currently running models
	 * GET /api/ps
	 */
	async listRunningModels(signal?: AbortSignal): Promise<OllamaRunningModelsResponse> {
		return this.request<OllamaRunningModelsResponse>('/api/ps', {
			method: 'GET',
			signal
		});
	}

	/**
	 * Shows detailed information about a model
	 * POST /api/show
	 */
	async showModel(
		modelOrRequest: string | OllamaShowRequest,
		signal?: AbortSignal
	): Promise<OllamaShowResponse> {
		const request: OllamaShowRequest =
			typeof modelOrRequest === 'string'
				? { model: modelOrRequest }
				: modelOrRequest;

		return this.request<OllamaShowResponse>('/api/show', {
			method: 'POST',
			body: JSON.stringify(request),
			signal
		});
	}

	// ==========================================================================
	// Chat Completion
	// ==========================================================================

	/**
	 * Generates a non-streaming chat completion
	 * POST /api/chat with stream: false
	 */
	async chat(
		options: ChatOptions,
		signal?: AbortSignal
	): Promise<OllamaChatResponse> {
		const request = this.buildChatRequest(options, false);

		return this.request<OllamaChatResponse>('/api/chat', {
			method: 'POST',
			body: JSON.stringify(request),
			signal,
			// Chat completions may take longer
			timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs * 2
		});
	}

	/**
	 * Generates a streaming chat completion using async generator
	 * POST /api/chat with stream: true
	 * @yields OllamaChatStreamChunk for each token
	 * @returns StreamChatResult with accumulated content
	 */
	streamChat(
		options: ChatOptions,
		signal?: AbortSignal
	): AsyncGenerator<OllamaChatStreamChunk, StreamChatResult, unknown> {
		const request = this.buildChatRequest(options, true);

		const streamOptions: StreamChatOptions = {
			baseUrl: this.config.baseUrl,
			timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
			signal,
			fetchFn: this.fetchFn
		};

		return streamChat(request, streamOptions);
	}

	/**
	 * Generates a streaming chat completion with callbacks
	 * More ergonomic for UI integrations
	 */
	async streamChatWithCallbacks(
		options: ChatOptions,
		callbacks: StreamChatCallbacks,
		signal?: AbortSignal
	): Promise<StreamChatResult> {
		const request = this.buildChatRequest(options, true);

		const streamOptions: StreamChatOptions = {
			baseUrl: this.config.baseUrl,
			timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
			signal,
			fetchFn: this.fetchFn
		};

		return streamChatWithCallbacks(request, callbacks, streamOptions);
	}

	// ==========================================================================
	// Text Generation (non-chat)
	// ==========================================================================

	/**
	 * Generates text completion (non-streaming)
	 * POST /api/generate with stream: false
	 */
	async generate(
		request: Omit<OllamaGenerateRequest, 'stream'>,
		signal?: AbortSignal
	): Promise<OllamaGenerateResponse> {
		return this.request<OllamaGenerateResponse>('/api/generate', {
			method: 'POST',
			body: JSON.stringify({ ...request, stream: false }),
			signal,
			timeoutMs: this.config.defaultTimeoutMs * 2
		});
	}

	// ==========================================================================
	// Embeddings
	// ==========================================================================

	/**
	 * Generates embeddings for text
	 * POST /api/embed
	 */
	async embed(
		request: OllamaEmbedRequest,
		signal?: AbortSignal
	): Promise<OllamaEmbedResponse> {
		return this.request<OllamaEmbedResponse>('/api/embed', {
			method: 'POST',
			body: JSON.stringify(request),
			signal
		});
	}

	// ==========================================================================
	// Health & Connectivity
	// ==========================================================================

	/**
	 * Checks if Ollama is reachable and responding
	 * Uses GET /api/version as a lightweight health check
	 */
	async healthCheck(signal?: AbortSignal): Promise<boolean> {
		try {
			await this.getVersion(signal);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Gets the Ollama version
	 * GET /api/version
	 */
	async getVersion(signal?: AbortSignal): Promise<OllamaVersionResponse> {
		return this.request<OllamaVersionResponse>('/api/version', {
			method: 'GET',
			signal,
			// Version check should be fast
			timeoutMs: 5000
		});
	}

	/**
	 * Tests connection and returns detailed status
	 */
	async testConnection(signal?: AbortSignal): Promise<ConnectionStatus> {
		const startTime = performance.now();

		try {
			const version = await this.getVersion(signal);
			const latencyMs = Math.round(performance.now() - startTime);

			return {
				connected: true,
				version: version.version,
				latencyMs,
				baseUrl: this.config.baseUrl
			};
		} catch (error) {
			const latencyMs = Math.round(performance.now() - startTime);
			const classified = classifyError(error);

			return {
				connected: false,
				error: classified.message,
				errorCode: classified.code,
				latencyMs,
				baseUrl: this.config.baseUrl
			};
		}
	}

	// ==========================================================================
	// Configuration
	// ==========================================================================

	/**
	 * Gets the current base URL
	 */
	get baseUrl(): string {
		return this.config.baseUrl;
	}

	/**
	 * Creates a new client with updated configuration
	 * (Immutable - returns new instance)
	 */
	withConfig(config: Partial<OllamaClientConfig>): OllamaClient {
		return new OllamaClient({
			...this.config,
			...config,
			retryOptions: config.retryOptions ?? this.retryOptions,
			fetchFn: config.fetchFn ?? this.fetchFn
		});
	}

	// ==========================================================================
	// Private Methods
	// ==========================================================================

	/**
	 * Makes an HTTP request to the Ollama API
	 */
	private async request<T>(
		endpoint: string,
		options: {
			method: 'GET' | 'POST' | 'DELETE';
			body?: string;
			signal?: AbortSignal;
			timeoutMs?: number;
		}
	): Promise<T> {
		const { method, body, signal, timeoutMs = this.config.defaultTimeoutMs } = options;
		const url = `${this.config.baseUrl}${endpoint}`;

		const doRequest = async (): Promise<T> => {
			// Create timeout controller
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

			// Combine with external signal
			const combinedSignal = signal
				? this.combineSignals(signal, controller.signal)
				: controller.signal;

			// Clean up timeout on external abort
			signal?.addEventListener('abort', () => {
				clearTimeout(timeoutId);
				controller.abort();
			}, { once: true });

			try {
				const response = await this.fetchFn(url, {
					method,
					headers: body ? { 'Content-Type': 'application/json' } : undefined,
					body,
					signal: combinedSignal
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					throw await createErrorFromResponse(response, endpoint);
				}

				return await response.json() as T;
			} catch (error) {
				clearTimeout(timeoutId);
				throw classifyError(error, `Request to ${endpoint} failed`);
			}
		};

		// Apply retry logic if enabled
		if (this.config.enableRetry) {
			return withRetry(doRequest, {
				...this.retryOptions,
				signal
			});
		}

		return doRequest();
	}

	/**
	 * Builds an OllamaChatRequest from ChatOptions
	 */
	private buildChatRequest(
		options: ChatOptions,
		stream: boolean
	): OllamaChatRequest {
		const request: OllamaChatRequest = {
			model: options.model,
			messages: options.messages,
			stream
		};

		if (options.format !== undefined) {
			request.format = options.format;
		}

		if (options.tools !== undefined) {
			request.tools = options.tools;
		}

		if (options.options !== undefined) {
			request.options = options.options;
		}

		if (options.keepAlive !== undefined) {
			request.keep_alive = options.keepAlive;
		}

		if (options.think !== undefined) {
			request.think = options.think;
		}

		return request;
	}

	/**
	 * Combines multiple AbortSignals into one
	 */
	private combineSignals(...signals: AbortSignal[]): AbortSignal {
		const controller = new AbortController();

		for (const signal of signals) {
			if (signal.aborted) {
				controller.abort(signal.reason);
				break;
			}

			signal.addEventListener(
				'abort',
				() => controller.abort(signal.reason),
				{ once: true, signal: controller.signal }
			);
		}

		return controller.signal;
	}
}

// ============================================================================
// Supporting Types
// ============================================================================

/** Options for chat completions */
export interface ChatOptions {
	/** Model name (e.g., "llama3.2", "mistral:7b") */
	model: string;
	/** Messages in the conversation */
	messages: OllamaMessage[];
	/** Format for structured output */
	format?: 'json' | JsonSchema;
	/** Tools available to the model */
	tools?: OllamaToolDefinition[];
	/** Model-specific options */
	options?: OllamaModelOptions;
	/** How long to keep model loaded */
	keepAlive?: string;
	/** Request timeout in milliseconds */
	timeoutMs?: number;
	/** Enable thinking mode for reasoning models (qwen3, deepseek-r1, etc.) */
	think?: boolean;
}

/** Result of connection test */
export interface ConnectionStatus {
	/** Whether connection was successful */
	connected: boolean;
	/** Ollama version (if connected) */
	version?: string;
	/** Error message (if not connected) */
	error?: string;
	/** Error code (if not connected) */
	errorCode?: string;
	/** Round-trip latency in milliseconds */
	latencyMs: number;
	/** Base URL that was tested */
	baseUrl: string;
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Default OllamaClient instance with standard configuration
 * Use this for simple use cases or import OllamaClient for custom configuration
 */
export const ollamaClient = new OllamaClient();

// Types are already exported above
export type { StreamChatResult, StreamChatCallbacks };
