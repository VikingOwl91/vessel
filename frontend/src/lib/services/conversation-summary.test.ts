/**
 * Conversation Summary Service tests
 *
 * Tests the pure utility functions for conversation summaries
 */

import { describe, it, expect } from 'vitest';
import { getSummaryPrompt } from './conversation-summary';
import type { Message } from '$lib/types/chat';

// Helper to create messages
function createMessage(
	role: 'user' | 'assistant' | 'system',
	content: string
): Message {
	return {
		role,
		content,
		timestamp: Date.now()
	};
}

describe('getSummaryPrompt', () => {
	it('formats user and assistant messages correctly', () => {
		const messages: Message[] = [
			createMessage('user', 'Hello!'),
			createMessage('assistant', 'Hi there!')
		];

		const prompt = getSummaryPrompt(messages);

		expect(prompt).toContain('User: Hello!');
		expect(prompt).toContain('Assistant: Hi there!');
		expect(prompt).toContain('Summarize this conversation');
	});

	it('filters out system messages', () => {
		const messages: Message[] = [
			createMessage('system', 'You are a helpful assistant'),
			createMessage('user', 'Hello!'),
			createMessage('assistant', 'Hi!')
		];

		const prompt = getSummaryPrompt(messages);

		expect(prompt).not.toContain('You are a helpful assistant');
		expect(prompt).toContain('User: Hello!');
	});

	it('respects maxMessages limit', () => {
		const messages: Message[] = [
			createMessage('user', 'Message 1'),
			createMessage('assistant', 'Response 1'),
			createMessage('user', 'Message 2'),
			createMessage('assistant', 'Response 2'),
			createMessage('user', 'Message 3'),
			createMessage('assistant', 'Response 3')
		];

		const prompt = getSummaryPrompt(messages, 4);

		// Should only include last 4 messages
		expect(prompt).not.toContain('Message 1');
		expect(prompt).not.toContain('Response 1');
		expect(prompt).toContain('Message 2');
		expect(prompt).toContain('Response 2');
		expect(prompt).toContain('Message 3');
		expect(prompt).toContain('Response 3');
	});

	it('truncates long message content to 500 chars', () => {
		const longContent = 'A'.repeat(600);
		const messages: Message[] = [createMessage('user', longContent)];

		const prompt = getSummaryPrompt(messages);

		// Content should be truncated
		expect(prompt).not.toContain('A'.repeat(600));
		expect(prompt).toContain('A'.repeat(500));
	});

	it('handles empty messages array', () => {
		const prompt = getSummaryPrompt([]);

		expect(prompt).toContain('Summarize this conversation');
		expect(prompt).toContain('Conversation:');
	});

	it('includes standard prompt instructions', () => {
		const messages: Message[] = [
			createMessage('user', 'Test'),
			createMessage('assistant', 'Test response')
		];

		const prompt = getSummaryPrompt(messages);

		expect(prompt).toContain('Summarize this conversation in 2-3 sentences');
		expect(prompt).toContain('Focus on the main topics');
		expect(prompt).toContain('Be concise');
		expect(prompt).toContain('Summary:');
	});

	it('uses default maxMessages of 20', () => {
		// Create 25 messages with distinct identifiers to avoid substring matches
		const messages: Message[] = [];
		for (let i = 0; i < 25; i++) {
			// Use letters to avoid number substring issues (Message 1 in Message 10)
			const letter = String.fromCharCode(65 + i); // A, B, C, ...
			messages.push(createMessage(i % 2 === 0 ? 'user' : 'assistant', `Msg-${letter}`));
		}

		const prompt = getSummaryPrompt(messages);

		// First 5 messages should not be included (25 - 20 = 5)
		expect(prompt).not.toContain('Msg-A');
		expect(prompt).not.toContain('Msg-E');
		// Message 6 onwards should be included
		expect(prompt).toContain('Msg-F');
		expect(prompt).toContain('Msg-Y'); // 25th message
	});

	it('separates messages with double newlines', () => {
		const messages: Message[] = [
			createMessage('user', 'First'),
			createMessage('assistant', 'Second')
		];

		const prompt = getSummaryPrompt(messages);

		expect(prompt).toContain('User: First\n\nAssistant: Second');
	});
});
