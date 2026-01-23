/**
 * Unified LLM Client
 * Routes chat requests through the unified /api/v1/ai/* endpoints
 * Supports Ollama, llama.cpp, and LM Studio backends transparently
 */

import type { BackendType } from '../stores/backends.svelte.js';

/** Message format (compatible with Ollama and OpenAI) */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	images?: string[];
	tool_calls?: ToolCall[];
}

/** Tool call in assistant message */
export interface ToolCall {
	function: {
		name: string;
		arguments: Record<string, unknown>;
	};
}

/** Tool definition */
export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, unknown>;
			required?: string[];
		};
	};
}

/** Chat request options */
export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	format?: 'json' | object;
	tools?: ToolDefinition[];
	options?: ModelOptions;
	keep_alive?: string;
}

/** Model-specific options */
export interface ModelOptions {
	temperature?: number;
	top_p?: number;
	top_k?: number;
	num_ctx?: number;
	num_predict?: number;
	stop?: string[];
	seed?: number;
}

/** Chat response chunk (NDJSON streaming format) */
export interface ChatChunk {
	model: string;
	message?: ChatMessage;
	done: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
	error?: string;
}

/** Model information */
export interface Model {
	name: string;
	size: number;
	digest: string;
	modified_at: string;
	details?: {
		family?: string;
		parameter_size?: string;
		quantization_level?: string;
	};
}

/** Models list response */
export interface ModelsResponse {
	models: Model[];
	backend: string;
}

/** Client configuration */
export interface UnifiedLLMClientConfig {
	baseUrl?: string;
	defaultTimeoutMs?: number;
	fetchFn?: typeof fetch;
}

const DEFAULT_CONFIG = {
	baseUrl: '',
	defaultTimeoutMs: 120000
};

/**
 * Unified LLM client that routes requests through the multi-backend API
 */
export class UnifiedLLMClient {
	private readonly config: Required<Omit<UnifiedLLMClientConfig, 'fetchFn'>>;
	private readonly fetchFn: typeof fetch;

	constructor(config: UnifiedLLMClientConfig = {}) {
		this.config = {
			...DEFAULT_CONFIG,
			...config
		};
		this.fetchFn = config.fetchFn ?? fetch;
	}

	/**
	 * Lists models from the active backend
	 */
	async listModels(signal?: AbortSignal): Promise<ModelsResponse> {
		return this.request<ModelsResponse>('/api/v1/ai/models', {
			method: 'GET',
			signal
		});
	}

	/**
	 * Non-streaming chat completion
	 */
	async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatChunk> {
		return this.request<ChatChunk>('/api/v1/ai/chat', {
			method: 'POST',
			body: JSON.stringify({ ...request, stream: false }),
			signal
		});
	}

	/**
	 * Streaming chat completion (async generator)
	 * Yields NDJSON chunks as they arrive
	 */
	async *streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatChunk, void, unknown> {
		const url = `${this.config.baseUrl}/api/v1/ai/chat`;

		const response = await this.fetchFn(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...request, stream: true }),
			signal
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
		}

		if (!response.body) {
			throw new Error('No response body for streaming');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete NDJSON lines
				let newlineIndex: number;
				while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);

					if (!line) continue;

					try {
						const chunk = JSON.parse(line) as ChatChunk;

						// Check for error in chunk
						if (chunk.error) {
							throw new Error(chunk.error);
						}

						yield chunk;

						// Stop if done
						if (chunk.done) {
							return;
						}
					} catch (e) {
						if (e instanceof SyntaxError) {
							console.warn('[UnifiedLLM] Failed to parse chunk:', line);
						} else {
							throw e;
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Streaming chat with callbacks (more ergonomic for UI)
	 */
	async streamChatWithCallbacks(
		request: ChatRequest,
		callbacks: {
			onChunk?: (chunk: ChatChunk) => void;
			onToken?: (token: string) => void;
			onComplete?: (fullResponse: ChatChunk) => void;
			onError?: (error: Error) => void;
		},
		signal?: AbortSignal
	): Promise<string> {
		let accumulatedContent = '';
		let lastChunk: ChatChunk | null = null;

		try {
			for await (const chunk of this.streamChat(request, signal)) {
				lastChunk = chunk;
				callbacks.onChunk?.(chunk);

				if (chunk.message?.content) {
					accumulatedContent += chunk.message.content;
					callbacks.onToken?.(chunk.message.content);
				}

				if (chunk.done && callbacks.onComplete) {
					callbacks.onComplete(chunk);
				}
			}
		} catch (error) {
			if (callbacks.onError && error instanceof Error) {
				callbacks.onError(error);
			}
			throw error;
		}

		return accumulatedContent;
	}

	/**
	 * Check health of a specific backend
	 */
	async healthCheck(type: BackendType, signal?: AbortSignal): Promise<boolean> {
		try {
			await this.request<{ status: string }>(`/api/v1/ai/backends/${type}/health`, {
				method: 'GET',
				signal,
				timeoutMs: 5000
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Make an HTTP request to the unified API
	 */
	private async request<T>(
		endpoint: string,
		options: {
			method: 'GET' | 'POST';
			body?: string;
			signal?: AbortSignal;
			timeoutMs?: number;
		}
	): Promise<T> {
		const { method, body, signal, timeoutMs = this.config.defaultTimeoutMs } = options;
		const url = `${this.config.baseUrl}${endpoint}`;

		// Create timeout controller
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		// Combine with external signal
		const combinedSignal = signal ? this.combineSignals(signal, controller.signal) : controller.signal;

		try {
			const response = await this.fetchFn(url, {
				method,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body,
				signal: combinedSignal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
			}

			return (await response.json()) as T;
		} catch (error) {
			clearTimeout(timeoutId);
			throw error;
		}
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

			signal.addEventListener('abort', () => controller.abort(signal.reason), {
				once: true,
				signal: controller.signal
			});
		}

		return controller.signal;
	}
}

/** Default client instance */
export const unifiedLLMClient = new UnifiedLLMClient();
