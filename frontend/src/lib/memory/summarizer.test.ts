/**
 * Summarizer utility tests
 *
 * Tests the pure functions for conversation summarization
 */

import { describe, it, expect } from 'vitest';
import {
	selectMessagesForSummarization,
	calculateTokenSavings,
	createSummaryRecord,
	shouldSummarize,
	formatSummaryAsContext
} from './summarizer';
import type { MessageNode } from '$lib/types/chat';

// Helper to create message nodes
function createMessageNode(
	role: 'user' | 'assistant' | 'system',
	content: string,
	id?: string
): MessageNode {
	return {
		id: id || crypto.randomUUID(),
		parentId: null,
		childIds: [],
		createdAt: new Date(),
		message: {
			role,
			content
		}
	};
}

describe('selectMessagesForSummarization', () => {
	it('returns empty toSummarize when messages <= preserveCount', () => {
		const messages = [
			createMessageNode('user', 'Hi'),
			createMessageNode('assistant', 'Hello'),
			createMessageNode('user', 'How are you?'),
			createMessageNode('assistant', 'Good')
		];

		const result = selectMessagesForSummarization(messages, 1000, 4);

		expect(result.toSummarize).toHaveLength(0);
		expect(result.toKeep).toHaveLength(4);
	});

	it('keeps recent messages and marks older for summarization', () => {
		const messages = [
			createMessageNode('user', 'Message 1'),
			createMessageNode('assistant', 'Response 1'),
			createMessageNode('user', 'Message 2'),
			createMessageNode('assistant', 'Response 2'),
			createMessageNode('user', 'Message 3'),
			createMessageNode('assistant', 'Response 3'),
			createMessageNode('user', 'Message 4'),
			createMessageNode('assistant', 'Response 4')
		];

		const result = selectMessagesForSummarization(messages, 1000, 4);

		expect(result.toSummarize).toHaveLength(4);
		expect(result.toKeep).toHaveLength(4);
		expect(result.toSummarize[0].message.content).toBe('Message 1');
		expect(result.toKeep[0].message.content).toBe('Message 3');
	});

	it('preserves system messages in toKeep', () => {
		const messages = [
			createMessageNode('system', 'System prompt'),
			createMessageNode('user', 'Message 1'),
			createMessageNode('assistant', 'Response 1'),
			createMessageNode('user', 'Message 2'),
			createMessageNode('assistant', 'Response 2'),
			createMessageNode('user', 'Message 3'),
			createMessageNode('assistant', 'Response 3')
		];

		const result = selectMessagesForSummarization(messages, 1000, 4);

		// System message should be in toKeep even though it's at the start
		expect(result.toKeep.some((m) => m.message.role === 'system')).toBe(true);
		expect(result.toSummarize.every((m) => m.message.role !== 'system')).toBe(true);
	});

	it('uses default preserveCount of 4', () => {
		const messages = [
			createMessageNode('user', 'M1'),
			createMessageNode('assistant', 'R1'),
			createMessageNode('user', 'M2'),
			createMessageNode('assistant', 'R2'),
			createMessageNode('user', 'M3'),
			createMessageNode('assistant', 'R3'),
			createMessageNode('user', 'M4'),
			createMessageNode('assistant', 'R4')
		];

		const result = selectMessagesForSummarization(messages, 1000);

		expect(result.toKeep).toHaveLength(4);
	});

	it('handles empty messages array', () => {
		const result = selectMessagesForSummarization([], 1000);

		expect(result.toSummarize).toHaveLength(0);
		expect(result.toKeep).toHaveLength(0);
	});

	it('handles single message', () => {
		const messages = [createMessageNode('user', 'Only message')];

		const result = selectMessagesForSummarization(messages, 1000, 4);

		expect(result.toSummarize).toHaveLength(0);
		expect(result.toKeep).toHaveLength(1);
	});
});

describe('calculateTokenSavings', () => {
	it('calculates positive savings for longer original', () => {
		const originalMessages = [
			createMessageNode('user', 'This is a longer message with more words'),
			createMessageNode('assistant', 'This is also a longer response with content')
		];

		const shortSummary = 'Brief summary.';
		const savings = calculateTokenSavings(originalMessages, shortSummary);

		expect(savings).toBeGreaterThan(0);
	});

	it('returns zero when summary is longer', () => {
		const originalMessages = [createMessageNode('user', 'Hi')];

		const longSummary =
			'This is a very long summary that is much longer than the original message which was just a simple greeting.';
		const savings = calculateTokenSavings(originalMessages, longSummary);

		expect(savings).toBe(0);
	});
});

describe('createSummaryRecord', () => {
	it('creates a valid summary record', () => {
		const record = createSummaryRecord('conv-123', 'This is the summary', 10, 500);

		expect(record.id).toBeDefined();
		expect(record.conversationId).toBe('conv-123');
		expect(record.summary).toBe('This is the summary');
		expect(record.originalMessageCount).toBe(10);
		expect(record.tokensSaved).toBe(500);
		expect(record.summarizedAt).toBeInstanceOf(Date);
	});

	it('generates unique IDs', () => {
		const record1 = createSummaryRecord('conv-1', 'Summary 1', 5, 100);
		const record2 = createSummaryRecord('conv-2', 'Summary 2', 5, 100);

		expect(record1.id).not.toBe(record2.id);
	});
});

describe('shouldSummarize', () => {
	it('returns false when message count is too low', () => {
		expect(shouldSummarize(8000, 10000, 4)).toBe(false);
		expect(shouldSummarize(8000, 10000, 5)).toBe(false);
	});

	it('returns false when summarizable messages are too few', () => {
		// 6 messages total - 4 preserved = 2 to summarize (minimum)
		// But with < 6 total messages, should return false
		expect(shouldSummarize(8000, 10000, 5)).toBe(false);
	});

	it('returns true when usage is high and enough messages', () => {
		// 8000/10000 = 80%
		expect(shouldSummarize(8000, 10000, 10)).toBe(true);
		expect(shouldSummarize(9000, 10000, 8)).toBe(true);
	});

	it('returns false when usage is below 80%', () => {
		expect(shouldSummarize(7000, 10000, 10)).toBe(false);
		expect(shouldSummarize(5000, 10000, 20)).toBe(false);
	});

	it('returns true at exactly 80%', () => {
		expect(shouldSummarize(8000, 10000, 10)).toBe(true);
	});
});

describe('formatSummaryAsContext', () => {
	it('formats summary as context prefix', () => {
		const result = formatSummaryAsContext('User asked about weather');

		expect(result).toBe('[Previous conversation summary: User asked about weather]');
	});

	it('handles empty summary', () => {
		const result = formatSummaryAsContext('');

		expect(result).toBe('[Previous conversation summary: ]');
	});

	it('preserves special characters in summary', () => {
		const result = formatSummaryAsContext('User said "hello" & asked about <code>');

		expect(result).toContain('"hello"');
		expect(result).toContain('&');
		expect(result).toContain('<code>');
	});
});
