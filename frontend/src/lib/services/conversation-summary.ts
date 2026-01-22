/**
 * Conversation Summary Service
 * Generates and manages conversation summaries for cross-chat context
 */

import { db } from '$lib/storage/db.js';
import { updateConversationSummary } from '$lib/storage/conversations.js';
import type { Message } from '$lib/types/chat.js';
import { indexConversationMessages } from './chat-indexer.js';

// ============================================================================
// Types
// ============================================================================

export interface SummaryGenerationOptions {
	/** Model to use for summary generation */
	model: string;
	/** Base URL for Ollama API (default: /api/v1/ollama, uses proxy) */
	baseUrl?: string;
	/** Maximum messages to include in summary context */
	maxMessages?: number;
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a summary for a conversation using the LLM
 * @param conversationId - The conversation to summarize
 * @param messages - The messages to summarize
 * @param options - Generation options
 * @returns The generated summary text
 */
export async function generateConversationSummary(
	conversationId: string,
	messages: Message[],
	options: SummaryGenerationOptions
): Promise<string> {
	const { model, baseUrl = '/api/v1/ollama', maxMessages = 20 } = options;

	// Filter to user and assistant messages only
	const relevantMessages = messages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.slice(-maxMessages); // Take last N messages

	if (relevantMessages.length === 0) {
		return '';
	}

	// Format messages for the prompt
	const conversationText = relevantMessages
		.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
		.join('\n\n');

	const prompt = `Summarize this conversation in 2-3 sentences. Focus on the main topics discussed, any decisions made, and key outcomes. Be concise.

Conversation:
${conversationText}

Summary:`;

	try {
		const response = await fetch(`${baseUrl}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				prompt,
				stream: false,
				options: {
					temperature: 0.3,
					num_predict: 150
				}
			})
		});

		if (!response.ok) {
			console.error('[ConversationSummary] Failed to generate summary:', response.statusText);
			return '';
		}

		const data = await response.json();
		return data.response?.trim() || '';
	} catch (error) {
		console.error('[ConversationSummary] Error generating summary:', error);
		return '';
	}
}

/**
 * Generate and save a summary for a conversation
 */
export async function generateAndSaveSummary(
	conversationId: string,
	messages: Message[],
	options: SummaryGenerationOptions
): Promise<boolean> {
	const summary = await generateConversationSummary(conversationId, messages, options);

	if (!summary) {
		return false;
	}

	const result = await updateConversationSummary(conversationId, summary);
	return result.success;
}

/**
 * Check if a conversation needs its summary updated
 * @param conversationId - The conversation to check
 * @param currentMessageCount - Current number of messages
 * @param threshold - Number of new messages before updating (default: 10)
 */
export async function needsSummaryUpdate(
	conversationId: string,
	currentMessageCount: number,
	threshold: number = 10
): Promise<boolean> {
	const conversation = await db.conversations.get(conversationId);

	if (!conversation) {
		return false;
	}

	// No summary yet - needs one if there are enough messages
	if (!conversation.summary) {
		return currentMessageCount >= 4; // At least 2 exchanges
	}

	// Check if enough new messages since last summary
	// This is a simple heuristic - could be improved with actual message tracking
	const lastSummaryTime = conversation.summaryUpdatedAt || conversation.createdAt;
	const timeSinceLastSummary = Date.now() - lastSummaryTime;

	// Update if more than 30 minutes old and conversation has grown
	return timeSinceLastSummary > 30 * 60 * 1000 && currentMessageCount >= 6;
}

/**
 * Get the summary prompt for manual triggering
 */
export function getSummaryPrompt(messages: Message[], maxMessages: number = 20): string {
	const relevantMessages = messages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.slice(-maxMessages);

	const conversationText = relevantMessages
		.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
		.join('\n\n');

	return `Summarize this conversation in 2-3 sentences. Focus on the main topics discussed, any decisions made, and key outcomes. Be concise.

Conversation:
${conversationText}

Summary:`;
}

/**
 * Trigger chat indexing and optional summary when user leaves a conversation
 * Runs in background to not block navigation
 * Indexes ALL conversations for global RAG search
 * Only generates summaries for project conversations
 */
export async function updateSummaryOnLeave(
	conversationId: string,
	messages: Message[],
	model: string,
	baseUrl?: string
): Promise<void> {
	// Get conversation to check project membership
	const conversation = await db.conversations.get(conversationId);
	if (!conversation) {
		return;
	}

	const projectId = conversation.projectId || null;

	// Run indexing and summary generation in background
	setTimeout(async () => {
		// Always index messages for RAG (all conversations, for global search)
		try {
			const indexed = await indexConversationMessages(conversationId, projectId, messages);
			if (indexed > 0) {
				console.log(`[ChatIndexer] Indexed ${indexed} chunks for conversation`);
			}
		} catch (error) {
			console.error('[ChatIndexer] Indexing failed:', error);
		}

		// Generate summary only for project conversations (4+ messages and enough time passed)
		if (projectId) {
			const needsUpdate = await needsSummaryUpdate(conversationId, messages.length);
			if (needsUpdate) {
				try {
					await generateAndSaveSummary(conversationId, messages, { model, baseUrl });
					console.log('[Summary] Summary completed');
				} catch (error) {
					console.error('[Summary] Summary generation failed:', error);
				}
			}
		}
	}, 100);
}
