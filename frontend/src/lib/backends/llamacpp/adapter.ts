/**
 * llama.cpp server backend adapter.
 * Implements the BackendClient interface for llama.cpp's OpenAI-compatible API.
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
	ToolCall,
	Tool,
	BackendError,
	ErrorCategory
} from '../types.js';

// ============================================================================
// OpenAI-Compatible Types (llama.cpp server format)
// ============================================================================

interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

interface OpenAIToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

interface OpenAITool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters?: Record<string, unknown>;
	};
}

interface OpenAIChatRequest {
	model: string;
	messages: OpenAIMessage[];
	stream?: boolean;
	tools?: OpenAITool[];
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	stop?: string[];
	seed?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	response_format?: { type: 'json_object' | 'text' };
}

interface OpenAIChoice {
	index: number;
	message: OpenAIMessage;
	finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

interface OpenAIUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

interface OpenAIChatResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: OpenAIChoice[];
	usage?: OpenAIUsage;
}

interface OpenAIStreamDelta {
	role?: 'assistant';
	content?: string | null;
	tool_calls?: OpenAIToolCallDelta[];
}

interface OpenAIToolCallDelta {
	index: number;
	id?: string;
	type?: 'function';
	function?: {
		name?: string;
		arguments?: string;
	};
}

interface OpenAIStreamChoice {
	index: number;
	delta: OpenAIStreamDelta;
	finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

interface OpenAIStreamChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: OpenAIStreamChoice[];
	usage?: OpenAIUsage;
}

interface LlamaCppHealthResponse {
	status: 'ok' | 'loading model' | 'error' | 'no slot available';
	slots_idle?: number;
	slots_processing?: number;
}

interface LlamaCppSlotsResponse {
	id: number;
	model: string;
	n_ctx: number;
	n_predict: number;
	state: number;
	next_token?: {
		has_next_token: boolean;
	};
	tokens_predicted?: number;
	tokens_evaluated?: number;
	t_token_generation?: number;
	t_prompt_processing?: number;
}

// ============================================================================
// Type Converters
// ============================================================================

/** Convert normalized Message to OpenAI message format */
function toOpenAIMessage(msg: Message): OpenAIMessage {
	const result: OpenAIMessage = {
		role: msg.role,
		content: msg.content
	};

	if (msg.toolCalls?.length) {
		result.tool_calls = msg.toolCalls.map((tc) => ({
			id: tc.id,
			type: 'function' as const,
			function: {
				name: tc.function.name,
				arguments: tc.function.arguments
			}
		}));
	}

	if (msg.toolCallId) {
		result.tool_call_id = msg.toolCallId;
	}

	return result;
}

/** Convert OpenAI message to normalized Message */
function fromOpenAIMessage(msg: OpenAIMessage): Message {
	const result: Message = {
		role: msg.role,
		content: msg.content ?? ''
	};

	if (msg.tool_calls?.length) {
		result.toolCalls = msg.tool_calls.map((tc) => ({
			id: tc.id,
			type: 'function' as const,
			function: {
				name: tc.function.name,
				arguments: tc.function.arguments
			}
		}));
	}

	if (msg.tool_call_id) {
		result.toolCallId = msg.tool_call_id;
	}

	return result;
}

/** Convert normalized Tool to OpenAI tool format */
function toOpenAITool(tool: Tool): OpenAITool {
	return {
		type: 'function',
		function: {
			name: tool.function.name,
			description: tool.function.description,
			parameters: (tool.function.parameters ?? {
				type: 'object',
				properties: {}
			}) as Record<string, unknown>
		}
	};
}

/** Build OpenAI chat request from normalized ChatRequest */
function buildOpenAIRequest(request: ChatRequest): OpenAIChatRequest {
	const openaiRequest: OpenAIChatRequest = {
		model: request.model,
		messages: request.messages.map(toOpenAIMessage),
		stream: request.stream
	};

	if (request.tools?.length) {
		openaiRequest.tools = request.tools.map(toOpenAITool);
	}

	if (request.options) {
		const opts = request.options;
		if (opts.temperature !== undefined) openaiRequest.temperature = opts.temperature;
		if (opts.topP !== undefined) openaiRequest.top_p = opts.topP;
		if (opts.maxTokens !== undefined) openaiRequest.max_tokens = opts.maxTokens;
		if (opts.stop !== undefined) openaiRequest.stop = opts.stop;
		if (opts.seed !== undefined) openaiRequest.seed = opts.seed;
		if (opts.presencePenalty !== undefined) openaiRequest.presence_penalty = opts.presencePenalty;
		if (opts.frequencyPenalty !== undefined) openaiRequest.frequency_penalty = opts.frequencyPenalty;
	}

	if (request.format === 'json') {
		openaiRequest.response_format = { type: 'json_object' };
	}

	return openaiRequest;
}

/** Normalize OpenAI finish_reason to our unified type */
function normalizeFinishReason(
	reason: 'stop' | 'length' | 'tool_calls' | null
): 'stop' | 'length' | 'tool_calls' | undefined {
	return reason ?? undefined;
}

/** Convert OpenAI response to normalized ChatResponse */
function fromOpenAIResponse(resp: OpenAIChatResponse): ChatResponse {
	const choice = resp.choices[0];
	return {
		model: resp.model,
		message: fromOpenAIMessage(choice.message),
		done: true,
		doneReason: normalizeFinishReason(choice.finish_reason),
		promptTokens: resp.usage?.prompt_tokens,
		responseTokens: resp.usage?.completion_tokens
	};
}

/** Categorize error from response or exception */
function categorizeError(error: unknown, statusCode?: number): ErrorCategory {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (error.name === 'AbortError') return 'cancelled';
		if (msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused')) {
			return 'network';
		}
		if (msg.includes('vram') || msg.includes('out of memory') || msg.includes('cuda')) {
			return 'vram_oom';
		}
		if (msg.includes('timeout')) return 'network';
	}

	if (statusCode) {
		if (statusCode === 401 || statusCode === 403) return 'auth';
		if (statusCode === 429) return 'rate_limit';
		if (statusCode >= 400 && statusCode < 500) return 'validation';
		if (statusCode >= 500) return 'runtime_crash';
	}

	return 'unknown';
}

/** Create BackendError with proper category detection */
function createLlamaCppError(error: unknown, statusCode?: number): BackendError {
	const category = categorizeError(error, statusCode);

	if (error instanceof Error) {
		return {
			code: error.name === 'AbortError' ? 'CANCELLED' : 'ERROR',
			message: error.message,
			category,
			retryable: category === 'network' || category === 'rate_limit',
			suggestion: getSuggestion(category)
		};
	}

	return {
		code: 'UNKNOWN',
		message: String(error),
		category,
		retryable: false
	};
}

/** Get suggestion text for error category */
function getSuggestion(category: ErrorCategory): string | undefined {
	switch (category) {
		case 'network':
			return 'Check that llama.cpp server is running and accessible';
		case 'vram_oom':
			return 'Try a smaller model or reduce context size';
		case 'rate_limit':
			return 'Wait a moment and try again';
		case 'auth':
			return 'Check API key configuration';
		default:
			return undefined;
	}
}

// ============================================================================
// llama.cpp Backend Adapter
// ============================================================================

export interface LlamaCppOptions {
	id?: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string;
}

/**
 * llama.cpp server backend implementation.
 * Uses the OpenAI-compatible API exposed by llama.cpp server.
 */
export class LlamaCppBackendAdapter implements BackendClient {
	readonly id: string;
	readonly type = 'llama-cpp-server' as const;
	readonly name: string;
	readonly capabilities: Capability[] = ['chat', 'streaming', 'tools'];

	private baseUrl: string;
	private apiKey?: string;
	private abortController: AbortController | null = null;
	private loadedModel: string | null = null;

	constructor(options: LlamaCppOptions = {}) {
		this.id = options.id ?? 'llamacpp-default';
		this.name = options.name ?? 'llama.cpp Server';
		this.baseUrl = (options.baseUrl ?? 'http://localhost:8080').replace(/\/$/, '');
		this.apiKey = options.apiKey;
	}

	// ==========================================================================
	// Core BackendClient Implementation
	// ==========================================================================

	async ping(signal?: AbortSignal): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/health`, {
				method: 'GET',
				signal,
				headers: this.getHeaders()
			});
			if (!response.ok) return false;
			const health = (await response.json()) as LlamaCppHealthResponse;
			return health.status === 'ok';
		} catch {
			return false;
		}
	}

	hasCapability(cap: Capability): boolean {
		return this.capabilities.includes(cap);
	}

	async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
		const openaiRequest = buildOpenAIRequest({ ...request, stream: false });

		const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify(openaiRequest),
			signal
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw createLlamaCppError(new Error(errorText), response.status);
		}

		const data = (await response.json()) as OpenAIChatResponse;
		this.loadedModel = data.model;
		return fromOpenAIResponse(data);
	}

	async *streamChat(
		request: ChatRequest,
		signal?: AbortSignal
	): AsyncGenerator<ChatStreamChunk, StreamResult, unknown> {
		this.abortController = new AbortController();
		const combinedSignal = signal
			? this.combineSignals(signal, this.abortController.signal)
			: this.abortController.signal;

		const openaiRequest = buildOpenAIRequest({ ...request, stream: true });

		const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify(openaiRequest),
			signal: combinedSignal
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw createLlamaCppError(new Error(errorText), response.status);
		}

		if (!response.body) {
			throw createLlamaCppError(new Error('No response body for streaming'));
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		let content = '';
		let toolCalls: ToolCall[] = [];
		let toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();
		let finalResponse: ChatResponse | undefined;
		let aborted = false;
		let model = request.model;
		let finishReason: 'stop' | 'length' | 'tool_calls' | undefined;
		let buffer = '';
		let promptTokens: number | undefined;
		let responseTokens: number | undefined;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data: ')) continue;

					const data = trimmed.slice(6);
					if (data === '[DONE]') {
						continue;
					}

					let chunk: OpenAIStreamChunk;
					try {
						chunk = JSON.parse(data) as OpenAIStreamChunk;
					} catch {
						continue;
					}

					model = chunk.model || model;

					if (chunk.usage) {
						promptTokens = chunk.usage.prompt_tokens;
						responseTokens = chunk.usage.completion_tokens;
					}

					const choice = chunk.choices[0];
					if (!choice) continue;

					if (choice.finish_reason) {
						finishReason = normalizeFinishReason(choice.finish_reason);
					}

					const delta = choice.delta;

					// Handle content
					if (delta.content) {
						content += delta.content;

						const streamChunk: ChatStreamChunk = {
							model,
							message: {
								role: 'assistant',
								content: delta.content
							},
							done: false
						};
						yield streamChunk;
					}

					// Handle tool calls
					if (delta.tool_calls?.length) {
						for (const tc of delta.tool_calls) {
							let inProgress = toolCallsInProgress.get(tc.index);

							if (!inProgress) {
								inProgress = {
									id: tc.id ?? `call_${tc.index}`,
									name: tc.function?.name ?? '',
									arguments: ''
								};
								toolCallsInProgress.set(tc.index, inProgress);
							}

							if (tc.function?.name) {
								inProgress.name = tc.function.name;
							}
							if (tc.function?.arguments) {
								inProgress.arguments += tc.function.arguments;
							}
						}
					}
				}
			}

			// Finalize tool calls
			if (toolCallsInProgress.size > 0) {
				toolCalls = Array.from(toolCallsInProgress.values()).map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: {
						name: tc.name,
						arguments: tc.arguments
					}
				}));
			}

			// Build final response
			finalResponse = {
				model,
				message: {
					role: 'assistant',
					content,
					toolCalls: toolCalls.length > 0 ? toolCalls : undefined
				},
				done: true,
				doneReason: finishReason,
				promptTokens,
				responseTokens
			};

			this.loadedModel = model;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				aborted = true;
			} else {
				throw error;
			}
		} finally {
			this.abortController = null;
			reader.releaseLock();
		}

		return {
			content,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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

				callbacks.onChunk?.(value);

				if (value.message.content) {
					callbacks.onToken?.(value.message.content);
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
			// Check health endpoint
			const healthResponse = await fetch(`${this.baseUrl}/health`, {
				method: 'GET',
				signal,
				headers: this.getHeaders()
			});

			if (healthResponse.ok) {
				const health = (await healthResponse.json()) as LlamaCppHealthResponse;
				status.available = health.status === 'ok';

				if (health.slots_idle !== undefined || health.slots_processing !== undefined) {
					status.queueDepth = health.slots_processing ?? 0;
				}
			}

			// Try to get slots info for more details
			try {
				const slotsResponse = await fetch(`${this.baseUrl}/slots`, {
					method: 'GET',
					signal,
					headers: this.getHeaders()
				});

				if (slotsResponse.ok) {
					const slots = (await slotsResponse.json()) as LlamaCppSlotsResponse[];
					if (slots.length > 0) {
						const slot = slots[0];
						status.loadedModel = slot.model || this.loadedModel || undefined;

						// Calculate metrics if available
						if (slot.tokens_predicted && slot.t_token_generation) {
							const tokensPerSec = (slot.tokens_predicted / slot.t_token_generation) * 1000;
							status.currentMetrics = {
								promptTokensPerSec: slot.t_prompt_processing
									? (slot.tokens_evaluated ?? 0) / slot.t_prompt_processing * 1000
									: 0,
								decodeTokensPerSec: tokensPerSec,
								contextUsed: slot.tokens_evaluated ?? 0,
								contextMax: slot.n_ctx
							};
						}
					}
				}
			} catch {
				// Slots endpoint may not be available
			}
		} catch {
			status.available = false;
		}

		return status;
	}

	async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
		try {
			// Try OpenAI-compatible models endpoint
			const response = await fetch(`${this.baseUrl}/v1/models`, {
				method: 'GET',
				signal,
				headers: this.getHeaders()
			});

			if (response.ok) {
				const data = await response.json();
				if (data.data && Array.isArray(data.data)) {
					return data.data.map((m: { id: string; created?: number; owned_by?: string }) => ({
						name: m.id,
						modifiedAt: new Date(m.created ? m.created * 1000 : Date.now()),
						size: 0,
						digest: '',
						family: m.owned_by
					}));
				}
			}

			// Fallback: if we have a loaded model from previous interactions
			if (this.loadedModel) {
				return [
					{
						name: this.loadedModel,
						modifiedAt: new Date(),
						size: 0,
						digest: ''
					}
				];
			}

			return [];
		} catch {
			// Return empty list on error
			if (this.loadedModel) {
				return [
					{
						name: this.loadedModel,
						modifiedAt: new Date(),
						size: 0,
						digest: ''
					}
				];
			}
			return [];
		}
	}

	async showModel(name: string, signal?: AbortSignal): Promise<ModelDetails> {
		// llama.cpp doesn't have a direct model info endpoint
		// Try to get info from /props endpoint if available
		try {
			const response = await fetch(`${this.baseUrl}/props`, {
				method: 'GET',
				signal,
				headers: this.getHeaders()
			});

			if (response.ok) {
				const props = await response.json();
				return {
					name: name,
					modifiedAt: new Date(),
					size: 0,
					digest: '',
					contextLength: props.default_generation_settings?.n_ctx,
					capabilities: ['chat', 'streaming']
				};
			}
		} catch {
			// Props endpoint may not be available
		}

		// Return basic info
		return {
			name: name,
			modifiedAt: new Date(),
			size: 0,
			digest: '',
			capabilities: ['chat', 'streaming']
		};
	}

	dispose(): void {
		this.cancel();
	}

	// ==========================================================================
	// Private Helpers
	// ==========================================================================

	private getHeaders(): HeadersInit {
		const headers: HeadersInit = {
			'Content-Type': 'application/json'
		};

		if (this.apiKey) {
			headers['Authorization'] = `Bearer ${this.apiKey}`;
		}

		return headers;
	}

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
 * Create a llama.cpp server backend adapter with the specified options.
 */
export function createLlamaCppBackend(options?: LlamaCppOptions): LlamaCppBackendAdapter {
	return new LlamaCppBackendAdapter(options);
}
