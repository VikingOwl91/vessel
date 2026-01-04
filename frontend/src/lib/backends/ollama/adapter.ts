/**
 * Ollama backend adapter.
 * Wraps the existing OllamaClient to implement the unified BackendClient interface.
 */

import type {
	BackendClient,
	PullableBackend,
	DeletableBackend,
	CreatableBackend,
	EmbeddableBackend
} from '../client.js';
import { createBackendError } from '../client.js';
import type {
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
	Message,
	ToolCall,
	Tool,
	GenerationOptions
} from '../types.js';

import { OllamaClient, type ChatOptions } from '$lib/ollama/client.js';
import type {
	OllamaMessage,
	OllamaToolCall,
	OllamaToolDefinition,
	OllamaChatStreamChunk,
	OllamaChatResponse,
	OllamaModelOptions,
	OllamaModel,
	OllamaShowResponse,
	OllamaCapability
} from '$lib/ollama/types.js';

// ============================================================================
// Type Converters
// ============================================================================

/** Convert normalized Message to OllamaMessage */
function toOllamaMessage(msg: Message): OllamaMessage {
	const result: OllamaMessage = {
		role: msg.role,
		content: msg.content
	};

	if (msg.images?.length) {
		result.images = msg.images;
	}

	if (msg.toolCalls?.length) {
		result.tool_calls = msg.toolCalls.map((tc) => ({
			function: {
				name: tc.function.name,
				arguments: JSON.parse(tc.function.arguments)
			}
		}));
	}

	if (msg.thinking) {
		result.thinking = msg.thinking;
	}

	return result;
}

/** Convert OllamaMessage to normalized Message */
function fromOllamaMessage(msg: OllamaMessage): Message {
	const result: Message = {
		role: msg.role,
		content: msg.content
	};

	if (msg.images?.length) {
		result.images = msg.images;
	}

	if (msg.tool_calls?.length) {
		result.toolCalls = msg.tool_calls.map((tc, i) => ({
			id: `call_${i}`,
			type: 'function' as const,
			function: {
				name: tc.function.name,
				arguments: JSON.stringify(tc.function.arguments)
			}
		}));
	}

	if (msg.thinking) {
		result.thinking = msg.thinking;
	}

	return result;
}

/** Convert normalized Tool to OllamaToolDefinition */
function toOllamaTool(tool: Tool): OllamaToolDefinition {
	return {
		type: 'function',
		function: {
			name: tool.function.name,
			description: tool.function.description,
			parameters: tool.function.parameters ?? {
				type: 'object',
				properties: {}
			}
		}
	};
}

/** Convert normalized GenerationOptions to OllamaModelOptions */
function toOllamaOptions(options?: GenerationOptions): OllamaModelOptions | undefined {
	if (!options) return undefined;

	const result: OllamaModelOptions = {};

	if (options.temperature !== undefined) result.temperature = options.temperature;
	if (options.topP !== undefined) result.top_p = options.topP;
	if (options.topK !== undefined) result.top_k = options.topK;
	if (options.maxTokens !== undefined) result.num_predict = options.maxTokens;
	if (options.stop !== undefined) result.stop = options.stop;
	if (options.seed !== undefined) result.seed = options.seed;
	if (options.repeatPenalty !== undefined) result.repeat_penalty = options.repeatPenalty;
	if (options.presencePenalty !== undefined) result.presence_penalty = options.presencePenalty;
	if (options.frequencyPenalty !== undefined) result.frequency_penalty = options.frequencyPenalty;
	if (options.contextSize !== undefined) result.num_ctx = options.contextSize;

	return Object.keys(result).length > 0 ? result : undefined;
}

/** Normalize Ollama done_reason to our unified type */
function normalizeDoneReason(
	reason: 'stop' | 'length' | 'load' | 'tool_calls' | undefined
): 'stop' | 'length' | 'tool_calls' | undefined {
	// 'load' is Ollama-specific (model loaded but no generation), treat as stop
	if (reason === 'load') return 'stop';
	return reason;
}

/** Convert OllamaChatResponse to normalized ChatResponse */
function fromOllamaResponse(resp: OllamaChatResponse): ChatResponse {
	return {
		model: resp.model,
		message: fromOllamaMessage(resp.message),
		done: resp.done,
		doneReason: normalizeDoneReason(resp.done_reason),
		promptTokens: resp.prompt_eval_count,
		responseTokens: resp.eval_count,
		totalDurationMs: resp.total_duration ? resp.total_duration / 1_000_000 : undefined,
		loadDurationMs: resp.load_duration ? resp.load_duration / 1_000_000 : undefined,
		promptEvalDurationMs: resp.prompt_eval_duration ? resp.prompt_eval_duration / 1_000_000 : undefined,
		evalDurationMs: resp.eval_duration ? resp.eval_duration / 1_000_000 : undefined
	};
}

/** Convert OllamaChatStreamChunk to normalized ChatStreamChunk */
function fromOllamaChunk(chunk: OllamaChatStreamChunk): ChatStreamChunk {
	return {
		model: chunk.model,
		message: fromOllamaMessage(chunk.message),
		done: chunk.done,
		doneReason: normalizeDoneReason(chunk.done_reason),
		promptTokens: chunk.prompt_eval_count,
		responseTokens: chunk.eval_count,
		totalDurationMs: chunk.total_duration ? chunk.total_duration / 1_000_000 : undefined
	};
}

/** Convert OllamaModel to normalized ModelInfo */
function fromOllamaModel(model: OllamaModel): ModelInfo {
	return {
		name: model.name,
		modifiedAt: new Date(model.modified_at),
		size: model.size,
		digest: model.digest,
		family: model.details.family,
		parameterSize: model.details.parameter_size,
		quantLevel: model.details.quantization_level
	};
}

/** Convert OllamaCapability to normalized Capability */
function fromOllamaCapability(cap: OllamaCapability): Capability | null {
	switch (cap) {
		case 'completion':
			return 'chat';
		case 'vision':
			return 'vision';
		case 'tools':
			return 'tools';
		case 'embedding':
			return 'embed';
		case 'thinking':
			return 'thinking';
		default:
			return null;
	}
}

/** Convert OllamaShowResponse to normalized ModelDetails */
function fromOllamaShowResponse(name: string, resp: OllamaShowResponse): ModelDetails {
	const capabilities: Capability[] = [];
	if (resp.capabilities) {
		for (const cap of resp.capabilities) {
			const normalized = fromOllamaCapability(cap);
			if (normalized) capabilities.push(normalized);
		}
	}

	return {
		name,
		modifiedAt: new Date(resp.modified_at),
		size: 0, // Not available in show response
		digest: '', // Not available in show response
		family: resp.details.family,
		parameterSize: resp.details.parameter_size,
		quantLevel: resp.details.quantization_level,
		capabilities,
		license: resp.license,
		modelfile: resp.modelfile,
		parameters: resp.parameters,
		template: resp.template
	};
}

// ============================================================================
// Ollama Backend Adapter
// ============================================================================

/**
 * Ollama backend implementation.
 * Wraps OllamaClient and adapts it to the unified BackendClient interface.
 */
export class OllamaBackendAdapter
	implements BackendClient, PullableBackend, DeletableBackend, CreatableBackend, EmbeddableBackend
{
	readonly id: string;
	readonly type = 'ollama' as const;
	readonly name: string;
	readonly capabilities: Capability[] = [
		'chat',
		'generate',
		'embed',
		'streaming',
		'pull',
		'delete',
		'create'
	];

	private client: OllamaClient;
	private abortController: AbortController | null = null;

	constructor(options: { id?: string; name?: string; baseUrl?: string } = {}) {
		this.id = options.id ?? 'ollama-default';
		this.name = options.name ?? 'Ollama';
		// Only pass baseUrl if explicitly provided to preserve OllamaClient's proxy default
		this.client = new OllamaClient(options.baseUrl ? { baseUrl: options.baseUrl } : {});
	}

	// ==========================================================================
	// Core BackendClient Implementation
	// ==========================================================================

	async ping(signal?: AbortSignal): Promise<boolean> {
		return this.client.healthCheck(signal);
	}

	hasCapability(cap: Capability): boolean {
		return this.capabilities.includes(cap);
	}

	async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
		const chatOptions: ChatOptions = {
			model: request.model,
			messages: request.messages.map(toOllamaMessage),
			format: request.format as 'json' | undefined,
			tools: request.tools?.map(toOllamaTool),
			options: toOllamaOptions(request.options),
			think: request.think
		};

		const response = await this.client.chat(chatOptions, signal);
		return fromOllamaResponse(response);
	}

	async *streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatStreamChunk, StreamResult, unknown> {
		// Track abort controller for cancellation
		this.abortController = new AbortController();
		const combinedSignal = signal
			? this.combineSignals(signal, this.abortController.signal)
			: this.abortController.signal;

		const chatOptions: ChatOptions = {
			model: request.model,
			messages: request.messages.map(toOllamaMessage),
			format: request.format as 'json' | undefined,
			tools: request.tools?.map(toOllamaTool),
			options: toOllamaOptions(request.options),
			think: request.think
		};

		const stream = this.client.streamChat(chatOptions, combinedSignal);
		let content = '';
		let thinking: string | undefined;
		let toolCalls: ToolCall[] | undefined;
		let finalResponse: ChatResponse | undefined;
		let aborted = false;

		try {
			while (true) {
				const { done, value } = await stream.next();

				if (done) {
					// value is StreamChatResult from ollama
					content = value.content;
					thinking = value.thinking;
					if (value.toolCalls) {
						toolCalls = value.toolCalls.map((tc, i) => ({
							id: `call_${i}`,
							type: 'function' as const,
							function: {
								name: tc.function.name,
								arguments: JSON.stringify(tc.function.arguments)
							}
						}));
					}
					if (value.response) {
						finalResponse = fromOllamaResponse(value.response);
					}
					break;
				}

				const chunk = fromOllamaChunk(value);
				content += chunk.message.content || '';
				if (chunk.message.thinking) {
					thinking = (thinking || '') + chunk.message.thinking;
				}

				yield chunk;
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				aborted = true;
			} else {
				throw error;
			}
		} finally {
			this.abortController = null;
		}

		return {
			content,
			thinking,
			toolCalls,
			response: finalResponse,
			aborted
		};
	}

	async streamChatWithCallbacks(
		request: ChatRequest,
		callbacks: StreamCallbacks,
		signal?: AbortSignal
	): Promise<StreamResult> {
		const stream = this.streamChat(request, signal);
		let result: StreamResult | undefined;

		try {
			while (true) {
				const { done, value } = await stream.next();

				if (done) {
					result = value;
					break;
				}

				// Fire callbacks
				callbacks.onChunk?.(value);

				if (value.message.content) {
					callbacks.onToken?.(value.message.content);
				}

				if (value.message.thinking) {
					callbacks.onThinking?.(value.message.thinking);
				}

				if (value.message.toolCalls?.length) {
					callbacks.onToolCall?.(value.message.toolCalls);
				}
			}

			const finalResult = result ?? { content: '', aborted: false };

			if (finalResult.response) {
				callbacks.onComplete?.(finalResult.response);
			}

			return finalResult;
		} catch (error) {
			const backendError = createBackendError(error, 'network');
			callbacks.onError?.(backendError);
			throw error;
		}
	}

	async cancel(): Promise<void> {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	async status(signal?: AbortSignal): Promise<BackendStatus> {
		const status: BackendStatus = {
			available: false
		};

		try {
			const connected = await this.client.healthCheck(signal);
			status.available = connected;

			if (connected) {
				const version = await this.client.getVersion(signal);
				status.version = version.version;

				const running = await this.client.listRunningModels(signal);
				if (running.models.length > 0) {
					status.loadedModel = running.models[0].name;
					if (running.models[0].size_vram > 0) {
						status.gpuMemoryUsed = running.models[0].size_vram;
					}
				}
			}
		} catch {
			status.available = false;
		}

		return status;
	}

	async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
		const response = await this.client.listModels(signal);
		return response.models.map(fromOllamaModel);
	}

	async showModel(name: string, signal?: AbortSignal): Promise<ModelDetails> {
		const response = await this.client.showModel(name, signal);
		return fromOllamaShowResponse(name, response);
	}

	dispose(): void {
		this.cancel();
	}

	// ==========================================================================
	// PullableBackend Implementation
	// ==========================================================================

	async pullModel(
		name: string,
		onProgress: (progress: PullProgress) => void,
		signal?: AbortSignal
	): Promise<void> {
		await this.client.pullModel(
			name,
			(p) =>
				onProgress({
					status: p.status,
					digest: p.digest,
					total: p.total,
					completed: p.completed
				}),
			signal
		);
	}

	// ==========================================================================
	// DeletableBackend Implementation
	// ==========================================================================

	async deleteModel(name: string, signal?: AbortSignal): Promise<void> {
		await this.client.deleteModel(name, signal);
	}

	// ==========================================================================
	// CreatableBackend Implementation
	// ==========================================================================

	async createModel(
		name: string,
		baseModel: string,
		systemPrompt: string,
		onProgress: (progress: PullProgress) => void,
		signal?: AbortSignal
	): Promise<void> {
		await this.client.createModel(
			{
				model: name,
				from: baseModel,
				system: systemPrompt
			},
			(p) => onProgress({ status: p.status }),
			signal
		);
	}

	// ==========================================================================
	// EmbeddableBackend Implementation
	// ==========================================================================

	async embed(request: EmbedRequest, signal?: AbortSignal): Promise<EmbedResponse> {
		const response = await this.client.embed(
			{
				model: request.model,
				input: request.input,
				options: toOllamaOptions(request.options)
			},
			signal
		);

		return {
			model: response.model,
			embeddings: response.embeddings,
			promptTokens: response.prompt_eval_count
		};
	}

	// ==========================================================================
	// Private Helpers
	// ==========================================================================

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

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Ollama backend adapter with the specified options.
 */
export function createOllamaBackend(options?: {
	id?: string;
	name?: string;
	baseUrl?: string;
}): OllamaBackendAdapter {
	return new OllamaBackendAdapter(options);
}
