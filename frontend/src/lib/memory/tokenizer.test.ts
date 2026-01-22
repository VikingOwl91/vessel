/**
 * Tokenizer utility tests
 *
 * Tests token estimation heuristics and formatting
 */

import { describe, it, expect } from 'vitest';
import {
	estimateTokensFromChars,
	estimateTokensFromWords,
	estimateTokens,
	estimateImageTokens,
	estimateMessageTokens,
	estimateFormatOverhead,
	estimateConversationTokens,
	formatTokenCount
} from './tokenizer';

describe('estimateTokensFromChars', () => {
	it('returns 0 for empty string', () => {
		expect(estimateTokensFromChars('')).toBe(0);
	});

	it('returns 0 for null/undefined', () => {
		expect(estimateTokensFromChars(null as unknown as string)).toBe(0);
		expect(estimateTokensFromChars(undefined as unknown as string)).toBe(0);
	});

	it('estimates tokens for short text', () => {
		// ~3.7 chars per token, so 10 chars ≈ 3 tokens
		const result = estimateTokensFromChars('hello worl');
		expect(result).toBe(3);
	});

	it('estimates tokens for longer text', () => {
		// 100 chars / 3.7 = 27.027, rounds up to 28
		const text = 'a'.repeat(100);
		expect(estimateTokensFromChars(text)).toBe(28);
	});

	it('rounds up partial tokens', () => {
		// 1 char / 3.7 = 0.27, should round to 1
		expect(estimateTokensFromChars('a')).toBe(1);
	});
});

describe('estimateTokensFromWords', () => {
	it('returns 0 for empty string', () => {
		expect(estimateTokensFromWords('')).toBe(0);
	});

	it('returns 0 for null/undefined', () => {
		expect(estimateTokensFromWords(null as unknown as string)).toBe(0);
	});

	it('estimates tokens for single word', () => {
		// 1 word * 1.3 = 1.3, rounds to 2
		expect(estimateTokensFromWords('hello')).toBe(2);
	});

	it('estimates tokens for multiple words', () => {
		// 5 words * 1.3 = 6.5, rounds to 7
		expect(estimateTokensFromWords('the quick brown fox jumps')).toBe(7);
	});

	it('handles multiple spaces between words', () => {
		expect(estimateTokensFromWords('hello    world')).toBe(3); // 2 words * 1.3
	});

	it('handles leading/trailing whitespace', () => {
		expect(estimateTokensFromWords('  hello world  ')).toBe(3);
	});
});

describe('estimateTokens', () => {
	it('returns 0 for empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('returns weighted average of char and word estimates', () => {
		// For "hello world" (11 chars, 2 words):
		// charEstimate: 11 / 3.7 ≈ 3
		// wordEstimate: 2 * 1.3 ≈ 3
		// hybrid: (3 * 0.6 + 3 * 0.4) = 3
		const result = estimateTokens('hello world');
		expect(result).toBeGreaterThan(0);
	});

	it('handles code with special characters', () => {
		const code = 'function test() { return 42; }';
		const result = estimateTokens(code);
		expect(result).toBeGreaterThan(0);
	});
});

describe('estimateImageTokens', () => {
	it('returns 0 for no images', () => {
		expect(estimateImageTokens(0)).toBe(0);
	});

	it('returns 765 tokens per image', () => {
		expect(estimateImageTokens(1)).toBe(765);
		expect(estimateImageTokens(2)).toBe(1530);
		expect(estimateImageTokens(5)).toBe(3825);
	});
});

describe('estimateMessageTokens', () => {
	it('handles text-only message', () => {
		const result = estimateMessageTokens('hello world');
		expect(result.textTokens).toBeGreaterThan(0);
		expect(result.imageTokens).toBe(0);
		expect(result.totalTokens).toBe(result.textTokens);
	});

	it('handles message with images', () => {
		const result = estimateMessageTokens('hello', ['base64img1', 'base64img2']);
		expect(result.textTokens).toBeGreaterThan(0);
		expect(result.imageTokens).toBe(1530); // 2 * 765
		expect(result.totalTokens).toBe(result.textTokens + result.imageTokens);
	});

	it('handles undefined images', () => {
		const result = estimateMessageTokens('hello', undefined);
		expect(result.imageTokens).toBe(0);
	});

	it('handles empty images array', () => {
		const result = estimateMessageTokens('hello', []);
		expect(result.imageTokens).toBe(0);
	});
});

describe('estimateFormatOverhead', () => {
	it('returns 0 for no messages', () => {
		expect(estimateFormatOverhead(0)).toBe(0);
	});

	it('returns 4 tokens per message', () => {
		expect(estimateFormatOverhead(1)).toBe(4);
		expect(estimateFormatOverhead(5)).toBe(20);
		expect(estimateFormatOverhead(10)).toBe(40);
	});
});

describe('estimateConversationTokens', () => {
	it('returns 0 for empty conversation', () => {
		expect(estimateConversationTokens([])).toBe(0);
	});

	it('sums tokens across messages plus overhead', () => {
		const messages = [
			{ content: 'hello' },
			{ content: 'world' }
		];
		const result = estimateConversationTokens(messages);
		// Should include text tokens for both messages + 8 format overhead
		expect(result).toBeGreaterThan(8);
	});

	it('includes image tokens', () => {
		const messagesWithoutImages = [{ content: 'hello' }];
		const messagesWithImages = [{ content: 'hello', images: ['img1'] }];

		const withoutImages = estimateConversationTokens(messagesWithoutImages);
		const withImages = estimateConversationTokens(messagesWithImages);

		expect(withImages).toBe(withoutImages + 765);
	});
});

describe('formatTokenCount', () => {
	it('formats small numbers as-is', () => {
		expect(formatTokenCount(0)).toBe('0');
		expect(formatTokenCount(100)).toBe('100');
		expect(formatTokenCount(999)).toBe('999');
	});

	it('formats thousands with K and one decimal', () => {
		expect(formatTokenCount(1000)).toBe('1.0K');
		expect(formatTokenCount(1500)).toBe('1.5K');
		expect(formatTokenCount(2350)).toBe('2.4K'); // rounds
		expect(formatTokenCount(9999)).toBe('10.0K');
	});

	it('formats large numbers with K and no decimal', () => {
		expect(formatTokenCount(10000)).toBe('10K');
		expect(formatTokenCount(50000)).toBe('50K');
		expect(formatTokenCount(128000)).toBe('128K');
	});
});
