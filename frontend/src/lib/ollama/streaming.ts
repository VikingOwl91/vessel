/**
 * Streaming implementation for Ollama API
 * Uses NDJSON (newline-delimited JSON) format with proper buffer handling
 */

import type {
	OllamaChatRequest,
	OllamaChatStreamChunk,
	OllamaChatResponse,
	OllamaToolCall
} from './types.js';
import {
	OllamaStreamError,
	OllamaParseError,
	OllamaAbortError,
	classifyError,
	createErrorFromResponse
} from './errors.js';

// ============================================================================
// Types
// ============================================================================

/** Options for streaming chat */
export interface StreamChatOptions {
	/** Base URL for Ollama API */
	baseUrl: string;
	/** Request timeout in milliseconds */
	timeoutMs?: number;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Custom fetch implementation (for testing) */
	fetchFn?: typeof fetch;
}

/** Result of the stream including final metrics */
export interface StreamChatResult {
	/** Full accumulated response text */
	content: string;
	/** Accumulated thinking/reasoning content (for reasoning models) */
	thinking?: string;
	/** Final response with metrics (if stream completed) */
	response?: OllamaChatResponse;
	/** Tool calls made by the model (if any) */
	toolCalls?: OllamaToolCall[];
}

// ============================================================================
// NDJSON Parser
// ============================================================================

/**
 * Parses NDJSON (newline-delimited JSON) stream with proper buffer handling
 * Handles partial chunks that may arrive across multiple reads
 */
export class NDJSONParser<T> {
	private buffer: string = '';
	private decoder: TextDecoder;

	constructor() {
		this.decoder = new TextDecoder();
	}

	/**
	 * Parses a chunk of data and yields complete JSON objects
	 * @param chunk - Raw bytes from the stream
	 * @yields Parsed JSON objects
	 */
	*parse(chunk: Uint8Array): Generator<T, void, unknown> {
		// Decode chunk and add to buffer
		this.buffer += this.decoder.decode(chunk, { stream: true });

		// Process complete lines
		let newlineIndex: number;
		while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);

			// Skip empty lines
			if (!line) {
				continue;
			}

			// Parse JSON
			try {
				yield JSON.parse(line) as T;
			} catch (error) {
				throw new OllamaParseError(
					`Failed to parse NDJSON line: ${error instanceof Error ? error.message : 'Unknown error'}`,
					line,
					error instanceof Error ? error : undefined
				);
			}
		}
	}

	/**
	 * Flushes any remaining data in the buffer
	 * Should be called when the stream ends
	 * @yields Any remaining complete JSON object
	 */
	*flush(): Generator<T, void, unknown> {
		// Flush decoder
		this.buffer += this.decoder.decode();

		// Process remaining buffer
		const remaining = this.buffer.trim();
		if (remaining) {
			try {
				yield JSON.parse(remaining) as T;
			} catch (error) {
				throw new OllamaParseError(
					`Failed to parse final NDJSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
					remaining,
					error instanceof Error ? error : undefined
				);
			}
		}

		this.buffer = '';
	}

	/**
	 * Resets the parser state
	 */
	reset(): void {
		this.buffer = '';
		this.decoder = new TextDecoder();
	}
}

// ============================================================================
// Stream Chat Function
// ============================================================================

/**
 * Streams a chat completion from Ollama API
 * @param request - Chat request parameters
 * @param options - Streaming options
 * @yields Chat stream chunks
 * @returns Final result with accumulated content
 */
export async function* streamChat(
	request: OllamaChatRequest,
	options: StreamChatOptions
): AsyncGenerator<OllamaChatStreamChunk, StreamChatResult, unknown> {
	const {
		baseUrl,
		timeoutMs = 120000,
		signal,
		fetchFn = fetch
	} = options;

	// Check for abort before starting
	if (signal?.aborted) {
		throw new OllamaAbortError('Request aborted before starting');
	}

	// Create abort controller for timeout
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	// Combine signals
	const combinedSignal = signal
		? combineAbortSignals(signal, controller.signal)
		: controller.signal;

	// Clean up on abort
	signal?.addEventListener('abort', () => {
		clearTimeout(timeoutId);
		controller.abort();
	}, { once: true });

	let response: Response;

	try {
		response = await fetchFn(`${baseUrl}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				...request,
				stream: true
			}),
			signal: combinedSignal
		});
	} catch (error) {
		clearTimeout(timeoutId);
		throw classifyError(error, 'Failed to connect to Ollama');
	}

	clearTimeout(timeoutId);

	// Check for HTTP errors
	if (!response.ok) {
		throw await createErrorFromResponse(response, 'Chat request failed');
	}

	// Ensure we have a body to stream
	if (!response.body) {
		throw new OllamaStreamError('Response body is null');
	}

	// Stream and parse NDJSON
	const reader = response.body.getReader();
	const parser = new NDJSONParser<OllamaChatStreamChunk>();

	let accumulatedContent = '';
	let accumulatedThinking = '';
	let finalResponse: OllamaChatResponse | undefined;
	let toolCalls: OllamaToolCall[] | undefined;

	try {
		while (true) {
			// Check for abort
			if (signal?.aborted) {
				throw new OllamaAbortError('Request aborted during streaming');
			}

			const { done, value } = await reader.read();

			if (done) {
				// Flush any remaining data
				for (const chunk of parser.flush()) {
					if (chunk.message?.content) {
						accumulatedContent += chunk.message.content;
					}
					if (chunk.message?.thinking) {
						accumulatedThinking += chunk.message.thinking;
					}
					if (chunk.message?.tool_calls) {
						toolCalls = chunk.message.tool_calls;
					}
					if (chunk.done) {
						finalResponse = chunk as OllamaChatResponse;
					}
					yield chunk;
				}
				break;
			}

			// Parse and yield chunks
			for (const chunk of parser.parse(value)) {
				if (chunk.message?.content) {
					accumulatedContent += chunk.message.content;
				}
				if (chunk.message?.thinking) {
					accumulatedThinking += chunk.message.thinking;
				}
				if (chunk.message?.tool_calls) {
					toolCalls = chunk.message.tool_calls;
				}
				if (chunk.done) {
					finalResponse = chunk as OllamaChatResponse;
				}
				yield chunk;
			}
		}
	} catch (error) {
		// Cancel the stream on error
		try {
			await reader.cancel();
		} catch {
			// Ignore cancel errors
		}
		throw classifyError(error, 'Streaming failed');
	}

	return {
		content: accumulatedContent,
		thinking: accumulatedThinking || undefined,
		response: finalResponse,
		toolCalls
	};
}

// ============================================================================
// Callback-based Streaming
// ============================================================================

/** Callbacks for streaming chat operations */
export interface StreamChatCallbacks {
	/** Called for each content token */
	onToken?: (token: string) => void;
	/** Called for each thinking token (reasoning models with think: true) */
	onThinkingToken?: (token: string) => void;
	/** Called with full chunk data */
	onChunk?: (chunk: OllamaChatStreamChunk) => void;
	/** Called when tool calls are received from the model */
	onToolCall?: (toolCalls: OllamaToolCall[]) => void;
	/** Called when streaming is complete */
	onComplete?: (result: StreamChatResult) => void;
	/** Called on error */
	onError?: (error: Error) => void;
}

/**
 * Streams a chat completion with callback-based API
 * @param request - Chat request parameters
 * @param callbacks - Callback functions
 * @param options - Streaming options
 * @returns Promise that resolves when streaming is complete
 */
export async function streamChatWithCallbacks(
	request: OllamaChatRequest,
	callbacks: StreamChatCallbacks,
	options: StreamChatOptions
): Promise<StreamChatResult> {
	const { onToken, onThinkingToken, onChunk, onToolCall, onComplete, onError } = callbacks;

	try {
		const stream = streamChat(request, options);
		let result: StreamChatResult | undefined;
		let toolCallsEmitted = false;

		while (true) {
			const { done, value } = await stream.next();

			if (done) {
				result = value;
				break;
			}

			// Call chunk callback
			onChunk?.(value);

			// Call thinking token callback for reasoning content
			if (value.message?.thinking) {
				onThinkingToken?.(value.message.thinking);
			}

			// Call token callback for content
			if (value.message?.content) {
				onToken?.(value.message.content);
			}

			// Call tool call callback when tool calls are received
			if (value.message?.tool_calls && !toolCallsEmitted) {
				onToolCall?.(value.message.tool_calls);
				toolCallsEmitted = true;
			}
		}

		// Ensure we have a result
		const finalResult = result ?? { content: '' };

		// Emit tool calls from final result if not already emitted
		if (finalResult.toolCalls && !toolCallsEmitted) {
			onToolCall?.(finalResult.toolCalls);
		}

		// Call complete callback
		onComplete?.(finalResult);

		return finalResult;
	} catch (error) {
		const classifiedError = classifyError(error);
		onError?.(classifiedError);
		throw classifiedError;
	}
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Combines multiple AbortSignals into one
 * The combined signal aborts when any of the input signals abort
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
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

/**
 * Collects all chunks from a stream into an array
 * Useful for testing or when you need all chunks at once
 */
export async function collectStream<T, R>(
	stream: AsyncGenerator<T, R, unknown>
): Promise<{ chunks: T[]; result: R }> {
	const chunks: T[] = [];
	let result: R;

	while (true) {
		const { done, value } = await stream.next();

		if (done) {
			result = value;
			break;
		}

		chunks.push(value);
	}

	return { chunks, result: result! };
}
