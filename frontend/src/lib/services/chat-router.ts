/**
 * Chat Router Service
 * Routes chat requests to the appropriate backend (Ollama or VLM).
 * Provides a unified interface for the ChatWindow component.
 */

import { backendsState } from '$lib/stores';
import { ollamaClient, type ChatOptions, type StreamChatCallbacks, type StreamChatResult } from '$lib/ollama';
import type { OllamaMessage, OllamaToolDefinition, OllamaChatResponse } from '$lib/ollama/types.js';

export interface ChatRouterRequest {
	model: string;
	messages: OllamaMessage[];
	tools?: OllamaToolDefinition[];
	think?: boolean;
	options?: Record<string, unknown>;
}

/**
 * Check if VLM is the active backend
 */
export function isVLMActive(): boolean {
	const primaryId = backendsState.primaryId;
	if (!primaryId) return false;

	const config = backendsState.getConfig(primaryId);
	return config?.type === 'vlm';
}

/**
 * Get the active backend type
 */
export function getActiveBackendType(): 'ollama' | 'vlm' | 'other' {
	const primaryId = backendsState.primaryId;
	if (!primaryId) return 'ollama';

	const config = backendsState.getConfig(primaryId);
	if (config?.type === 'vlm') return 'vlm';
	if (config?.type === 'ollama') return 'ollama';
	return 'other';
}

/**
 * Stream chat using the appropriate backend.
 * Uses VLM if it's the primary backend, otherwise uses Ollama.
 */
export async function streamChat(
	request: ChatRouterRequest,
	callbacks: StreamChatCallbacks,
	signal?: AbortSignal
): Promise<StreamChatResult> {
	const backendType = getActiveBackendType();

	if (backendType === 'vlm') {
		// Use VLM backend via backendsState
		const primary = backendsState.primary;
		if (!primary) {
			throw new Error('No primary backend available');
		}

		// Convert to backend format
		const backendRequest = {
			model: request.model,
			messages: request.messages.map((m) => ({
				role: m.role as 'system' | 'user' | 'assistant' | 'tool',
				content: m.content
			})),
			stream: true,
			options: request.options
				? {
						temperature: request.options.temperature as number | undefined,
						topP: request.options.top_p as number | undefined,
						topK: request.options.top_k as number | undefined,
						maxTokens: request.options.num_predict as number | undefined,
						contextSize: request.options.num_ctx as number | undefined
					}
				: undefined
		};

		// Accumulate content for result
		let fullContent = '';

		const result = await primary.streamChatWithCallbacks(
			backendRequest,
			{
				onToken: (token) => {
					fullContent += token;
					callbacks.onToken?.(token);
				},
				onComplete: (response) => {
					// Convert to StreamChatResult format
					const streamResult: StreamChatResult = {
						content: fullContent,
						response: {
							model: response.model,
							message: {
								role: response.message.role,
								content: response.message.content
							},
							done: true,
							done_reason: response.doneReason
						} as OllamaChatResponse
					};
					callbacks.onComplete?.(streamResult);
				},
				onError: (error) => {
					callbacks.onError?.(new Error(error.message));
				}
			},
			signal
		);

		return {
			content: result.content,
			response: result.response
				? ({
						model: result.response.model,
						message: {
							role: result.response.message.role,
							content: result.response.message.content
						},
						done: true
					} as OllamaChatResponse)
				: undefined
		};
	} else {
		// Use Ollama client (default)
		return ollamaClient.streamChatWithCallbacks(
			{
				model: request.model,
				messages: request.messages,
				tools: request.tools,
				think: request.think,
				options: request.options
			},
			callbacks,
			signal
		);
	}
}

/**
 * Cancel any in-progress chat.
 */
export async function cancelChat(): Promise<void> {
	const backendType = getActiveBackendType();

	if (backendType === 'vlm') {
		await backendsState.primary?.cancel();
	}
	// Ollama client doesn't have a cancel method - it uses AbortSignal
}
