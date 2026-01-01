/**
 * Conversation summarization service
 *
 * Generates summaries of conversation history to compress context
 * when approaching context window limits.
 */

import { ollamaClient } from '$lib/ollama';
import type { MessageNode } from '$lib/types/chat.js';
import type { ConversationSummary } from './types.js';
import { estimateMessageTokens, estimateConversationTokens } from './tokenizer.js';

/** Default prompt for generating summaries */
const SUMMARIZATION_PROMPT = `Summarize the following conversation concisely, capturing key points, decisions, and context that would be needed to continue the conversation. Focus on:
- Main topics discussed
- Important facts or information shared
- Decisions or conclusions reached
- Any pending questions or tasks

Keep the summary brief but complete. Write in third person.

Conversation:
`;

/** Minimum messages required in the toSummarize array (after filtering) */
const MIN_MESSAGES_TO_SUMMARIZE = 2;

/** Minimum total messages before showing summarization option */
const MIN_TOTAL_MESSAGES_FOR_SUMMARY = 6;

/** How many recent messages to always preserve */
const PRESERVE_RECENT_MESSAGES = 4;

/** Target reduction ratio (aim to reduce to this fraction of original) */
const TARGET_REDUCTION_RATIO = 0.25;

/**
 * Format messages for summarization prompt
 */
function formatMessagesForSummary(messages: MessageNode[]): string {
	return messages
		.map((node) => {
			const role = node.message.role === 'user' ? 'User' : 'Assistant';
			const content = node.message.content;
			const images = node.message.images?.length
				? ` [${node.message.images.length} image(s)]`
				: '';
			return `${role}:${images} ${content}`;
		})
		.join('\n\n');
}

/**
 * Generate a summary of messages using Ollama
 */
export async function generateSummary(
	messages: MessageNode[],
	model: string
): Promise<string> {
	if (messages.length < MIN_MESSAGES_TO_SUMMARIZE) {
		throw new Error('Not enough messages to summarize');
	}

	const formattedConversation = formatMessagesForSummary(messages);
	const prompt = SUMMARIZATION_PROMPT + formattedConversation;

	const response = await ollamaClient.generate({
		model,
		prompt,
		options: {
			temperature: 0.3, // Lower temperature for more consistent summaries
			num_predict: 500 // Limit summary length
		}
	});

	return response.response;
}

/**
 * Determine which messages should be summarized
 * Returns indices of messages to summarize (older messages) and messages to keep
 */
export function selectMessagesForSummarization(
	messages: MessageNode[],
	targetFreeTokens: number
): { toSummarize: MessageNode[]; toKeep: MessageNode[] } {
	if (messages.length <= PRESERVE_RECENT_MESSAGES) {
		return { toSummarize: [], toKeep: messages };
	}

	// Calculate how many messages to summarize
	// Keep the recent ones, summarize the rest
	const cutoffIndex = Math.max(0, messages.length - PRESERVE_RECENT_MESSAGES);

	// Filter out system messages from summarization (they should stay)
	const toSummarize: MessageNode[] = [];
	const toKeep: MessageNode[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (i < cutoffIndex && msg.message.role !== 'system') {
			toSummarize.push(msg);
		} else {
			toKeep.push(msg);
		}
	}

	return { toSummarize, toKeep };
}

/**
 * Calculate token savings from summarization
 */
export function calculateTokenSavings(
	originalMessages: MessageNode[],
	summaryText: string
): number {
	const originalTokens = estimateConversationTokens(
		originalMessages.map((m) => ({
			content: m.message.content,
			images: m.message.images
		}))
	);

	const summaryTokens = estimateMessageTokens(summaryText).totalTokens;

	return Math.max(0, originalTokens - summaryTokens);
}

/**
 * Create a summary record
 */
export function createSummaryRecord(
	conversationId: string,
	summary: string,
	originalMessageCount: number,
	tokensSaved: number
): ConversationSummary {
	return {
		id: crypto.randomUUID(),
		conversationId,
		summary,
		originalMessageCount,
		summarizedAt: new Date(),
		tokensSaved
	};
}

/**
 * Check if conversation should be summarized based on context usage
 */
export function shouldSummarize(
	usedTokens: number,
	maxTokens: number,
	messageCount: number
): boolean {
	// Don't show summarization if not enough total messages
	if (messageCount < MIN_TOTAL_MESSAGES_FOR_SUMMARY) {
		return false;
	}

	// Check if there would actually be messages to summarize after filtering
	// (messageCount - PRESERVE_RECENT_MESSAGES = messages available for summarization)
	const summarizableCount = messageCount - PRESERVE_RECENT_MESSAGES;
	if (summarizableCount < MIN_MESSAGES_TO_SUMMARIZE) {
		return false;
	}

	// Summarize if we're using more than 80% of context
	const usageRatio = usedTokens / maxTokens;
	return usageRatio >= 0.8;
}

/**
 * Format a summary as a system message prefix
 */
export function formatSummaryAsContext(summary: string): string {
	return `[Previous conversation summary: ${summary}]`;
}
