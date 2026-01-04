/**
 * VLM (Vessel Llama Manager) backend adapter.
 * Provides a unified BackendClient interface for the VLM daemon.
 * VLM manages llama.cpp processes with safe switching and scheduling.
 */

import type { BackendClient } from '../client.js';
import { createBackendError } from '../client.js';
import type {
	Capability,
	ChatRequest,
	ChatResponse,
	ChatStreamChunk,
	ModelInfo,
	ModelDetails,
	BackendStatus,
	StreamCallbacks,
	StreamResult,
	Message,
	GenerationOptions
} from '../types.js';

// ============================================================================
// Configuration
// ============================================================================

interface VLMAdapterConfig {
	id: string;
	name: string;
	baseUrl?: string;
}

// ============================================================================
// Type Converters
// ============================================================================

/** Convert normalized Message to VLM/OpenAI format */
function toVLMMessage(msg: Message): { role: string; content: string } {
	return {
		role: msg.role,
		content: msg.content
	};
}

/** Convert VLM response message to normalized Message */
function fromVLMMessage(msg: { role: string; content: string }): Message {
	return {
		role: msg.role as Message['role'],
		content: msg.content
	};
}

/** Convert normalized GenerationOptions to VLM/OpenAI format */
function toVLMOptions(options?: GenerationOptions): Record<string, unknown> {
	if (!options) return {};

	const result: Record<string, unknown> = {};

	if (options.temperature !== undefined) result.temperature = options.temperature;
	if (options.topP !== undefined) result.top_p = options.topP;
	if (options.maxTokens !== undefined) result.max_tokens = options.maxTokens;
	if (options.stop !== undefined) result.stop = options.stop;

	return result;
}

// ============================================================================
// VLM Backend Adapter
// ============================================================================

/**
 * VLM backend implementation.
 * Communicates with the Vessel backend which proxies to VLM.
 */
class VLMBackendAdapter implements BackendClient {
	readonly id: string;
	readonly type = 'vlm' as const;
	readonly name: string;
	readonly capabilities: Capability[] = ['chat', 'generate', 'streaming'];

	private readonly baseUrl: string;
	private abortController: AbortController | null = null;

	constructor(config: VLMAdapterConfig) {
		this.id = config.id;
		this.name = config.name;
		// Use the Vessel backend's VLM proxy endpoint
		this.baseUrl = config.baseUrl || '';
	}

	hasCapability(cap: Capability): boolean {
		return this.capabilities.includes(cap);
	}

	async ping(signal?: AbortSignal): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/api/v1/runtimes`, { signal });
			if (!response.ok) return false;

			const data = await response.json();
			const vlmRuntime = data.runtimes?.find((r: { name: string }) => r.name === 'vlm');
			return vlmRuntime?.available ?? false;
		} catch {
			return false;
		}
	}

	async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
		const body = {
			model: request.model,
			messages: request.messages.map(toVLMMessage),
			stream: false,
			...toVLMOptions(request.options)
		};

		const response = await fetch(`${this.baseUrl}/api/v1/llm/backends/vlm/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Unknown error' }));
			throw createBackendError(new Error(error.error || `HTTP ${response.status}`), 'network');
		}

		const data = await response.json();

		return {
			model: data.model,
			message: fromVLMMessage(data.message),
			done: data.done ?? true,
			doneReason: data.done_reason || 'stop',
			promptTokens: data.prompt_eval_count,
			responseTokens: data.eval_count
		};
	}

	async *streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatStreamChunk, StreamResult, unknown> {
		this.abortController = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;

		const body = {
			model: request.model,
			messages: request.messages.map(toVLMMessage),
			stream: true,
			...toVLMOptions(request.options)
		};

		const response = await fetch(`${this.baseUrl}/api/v1/llm/backends/vlm/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: combinedSignal
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Unknown error' }));
			throw createBackendError(new Error(error.error || `HTTP ${response.status}`), 'network');
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw createBackendError(new Error('No response body'), 'network');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let fullContent = '';
		let lastChunk: ChatStreamChunk | null = null;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete lines (NDJSON format)
				let newlineIndex: number;
				while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);

					if (!line) continue;

					try {
						const data = JSON.parse(line);

						const chunk: ChatStreamChunk = {
							model: data.model,
							message: {
								role: 'assistant',
								content: data.message?.content || ''
							},
							done: data.done ?? false,
							doneReason: data.done_reason
						};

						fullContent += chunk.message.content;
						lastChunk = chunk;

						yield chunk;
					} catch {
						// Skip malformed lines
					}
				}
			}
		} finally {
			reader.releaseLock();
			this.abortController = null;
		}

		return {
			content: fullContent,
			response: lastChunk
				? {
						model: lastChunk.model,
						message: { role: 'assistant', content: fullContent },
						done: true,
						doneReason: lastChunk.doneReason
					}
				: undefined,
			aborted: false
		};
	}

	async streamChatWithCallbacks(
		request: ChatRequest,
		callbacks: StreamCallbacks,
		signal?: AbortSignal
	): Promise<StreamResult> {
		let fullContent = '';
		let lastResponse: ChatResponse | undefined;
		let aborted = false;

		try {
			for await (const chunk of this.streamChat(request, signal)) {
				fullContent += chunk.message.content;

				callbacks.onToken?.(chunk.message.content);
				callbacks.onChunk?.(chunk);

				if (chunk.done) {
					lastResponse = {
						model: chunk.model,
						message: { role: 'assistant', content: fullContent },
						done: true,
						doneReason: chunk.doneReason,
						promptTokens: chunk.promptTokens,
						responseTokens: chunk.responseTokens
					};
				}
			}

			if (lastResponse) {
				callbacks.onComplete?.(lastResponse);
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				aborted = true;
			} else {
				callbacks.onError?.(createBackendError(error, 'runtime_crash'));
				throw error;
			}
		}

		return {
			content: fullContent,
			response: lastResponse,
			aborted
		};
	}

	async cancel(): Promise<void> {
		this.abortController?.abort();
		this.abortController = null;
	}

	async status(signal?: AbortSignal): Promise<BackendStatus> {
		try {
			const response = await fetch(`${this.baseUrl}/api/v1/runtimes`, { signal });
			if (!response.ok) {
				return { available: false };
			}

			const data = await response.json();
			const vlmRuntime = data.runtimes?.find((r: { name: string }) => r.name === 'vlm');

			if (!vlmRuntime) {
				return { available: false };
			}

			return {
				available: vlmRuntime.available ?? false,
				loadedModel: vlmRuntime.model
			};
		} catch {
			return { available: false };
		}
	}

	async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
		try {
			const response = await fetch(`${this.baseUrl}/api/v1/llm/backends/vlm/models`, { signal });
			if (!response.ok) {
				return [];
			}

			const data = await response.json();
			const models = data.models || [];

			return models.map(
				(m: { name: string; modifiedAt?: string; size?: number; digest?: string }) => ({
					name: m.name,
					modifiedAt: m.modifiedAt ? new Date(m.modifiedAt) : new Date(),
					size: m.size || 0,
					digest: m.digest || '',
					capabilities: ['chat', 'generate', 'streaming'] as Capability[]
				})
			);
		} catch {
			return [];
		}
	}

	async showModel(name: string, signal?: AbortSignal): Promise<ModelDetails> {
		// VLM doesn't have detailed model info like Ollama
		// Return basic info
		return {
			name,
			modifiedAt: new Date(),
			size: 0,
			digest: '',
			capabilities: ['chat', 'generate', 'streaming']
		};
	}

	dispose(): void {
		this.cancel();
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a VLM backend adapter.
 */
export function createVLMBackend(config: VLMAdapterConfig): BackendClient {
	return new VLMBackendAdapter(config);
}
