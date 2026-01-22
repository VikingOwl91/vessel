/**
 * Chunker tests
 *
 * Tests the text chunking utilities for RAG
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	chunkText,
	splitByParagraphs,
	splitBySentences,
	estimateChunkTokens,
	mergeSmallChunks
} from './chunker';
import type { DocumentChunk } from './types';

// Mock crypto.randomUUID for deterministic tests
let uuidCounter = 0;
beforeEach(() => {
	uuidCounter = 0;
	vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `test-uuid-${++uuidCounter}`);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('splitByParagraphs', () => {
	it('splits text by double newlines', () => {
		const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
		const result = splitByParagraphs(text);

		expect(result).toEqual([
			'First paragraph.',
			'Second paragraph.',
			'Third paragraph.'
		]);
	});

	it('handles extra whitespace between paragraphs', () => {
		const text = 'First.\n\n\n\nSecond.\n  \n  \nThird.';
		const result = splitByParagraphs(text);

		expect(result).toEqual(['First.', 'Second.', 'Third.']);
	});

	it('returns empty array for empty input', () => {
		expect(splitByParagraphs('')).toEqual([]);
		expect(splitByParagraphs('   ')).toEqual([]);
	});

	it('returns single element for text without paragraph breaks', () => {
		const text = 'Single paragraph with no breaks.';
		const result = splitByParagraphs(text);

		expect(result).toEqual(['Single paragraph with no breaks.']);
	});
});

describe('splitBySentences', () => {
	it('splits by periods', () => {
		const text = 'First sentence. Second sentence. Third sentence.';
		const result = splitBySentences(text);

		expect(result).toEqual([
			'First sentence.',
			'Second sentence.',
			'Third sentence.'
		]);
	});

	it('splits by exclamation marks', () => {
		const text = 'Wow! That is amazing! Really!';
		const result = splitBySentences(text);

		expect(result).toEqual(['Wow!', 'That is amazing!', 'Really!']);
	});

	it('splits by question marks', () => {
		const text = 'Is this working? Are you sure? Yes.';
		const result = splitBySentences(text);

		expect(result).toEqual(['Is this working?', 'Are you sure?', 'Yes.']);
	});

	it('handles mixed punctuation', () => {
		const text = 'Hello. How are you? Great! Thanks.';
		const result = splitBySentences(text);

		expect(result).toEqual(['Hello.', 'How are you?', 'Great!', 'Thanks.']);
	});

	it('returns empty array for empty input', () => {
		expect(splitBySentences('')).toEqual([]);
	});
});

describe('estimateChunkTokens', () => {
	it('estimates roughly 4 characters per token', () => {
		// 100 characters should be ~25 tokens
		const text = 'a'.repeat(100);
		expect(estimateChunkTokens(text)).toBe(25);
	});

	it('rounds up for partial tokens', () => {
		// 10 characters = 2.5 tokens, rounds to 3
		const text = 'a'.repeat(10);
		expect(estimateChunkTokens(text)).toBe(3);
	});

	it('returns 0 for empty string', () => {
		expect(estimateChunkTokens('')).toBe(0);
	});
});

describe('chunkText', () => {
	const DOC_ID = 'test-doc';

	it('returns empty array for empty text', () => {
		expect(chunkText('', DOC_ID)).toEqual([]);
	});

	it('returns single chunk for short text', () => {
		const text = 'Short text that fits in one chunk.';
		const result = chunkText(text, DOC_ID, { chunkSize: 512 });

		expect(result).toHaveLength(1);
		expect(result[0].content).toBe(text);
		expect(result[0].documentId).toBe(DOC_ID);
		expect(result[0].startIndex).toBe(0);
		expect(result[0].endIndex).toBe(text.length);
	});

	it('splits long text into multiple chunks', () => {
		// Create text longer than chunk size
		const text = 'This is sentence one. '.repeat(50);
		const result = chunkText(text, DOC_ID, { chunkSize: 200, overlap: 20 });

		expect(result.length).toBeGreaterThan(1);

		// Each chunk should be roughly chunk size (allowing for break points)
		for (const chunk of result) {
			expect(chunk.content.length).toBeLessThanOrEqual(250); // Some flexibility for break points
			expect(chunk.documentId).toBe(DOC_ID);
		}
	});

	it('respects sentence boundaries when enabled', () => {
		const text = 'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.';
		const result = chunkText(text, DOC_ID, {
			chunkSize: 50,
			overlap: 10,
			respectSentences: true
		});

		// Chunks should not split mid-sentence
		for (const chunk of result) {
			// Each chunk should end with punctuation or be the last chunk
			const endsWithPunctuation = /[.!?]$/.test(chunk.content);
			const isLastChunk = chunk === result[result.length - 1];
			expect(endsWithPunctuation || isLastChunk).toBe(true);
		}
	});

	it('creates chunks with correct indices', () => {
		const text = 'A'.repeat(100) + ' ' + 'B'.repeat(100);
		const result = chunkText(text, DOC_ID, { chunkSize: 100, overlap: 10 });

		// Verify indices are valid
		for (const chunk of result) {
			expect(chunk.startIndex).toBeGreaterThanOrEqual(0);
			expect(chunk.endIndex).toBeLessThanOrEqual(text.length);
			expect(chunk.startIndex).toBeLessThan(chunk.endIndex);
		}
	});

	it('generates unique IDs for each chunk', () => {
		const text = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
		const result = chunkText(text, DOC_ID, { chunkSize: 30, overlap: 5 });

		const ids = result.map(c => c.id);
		const uniqueIds = new Set(ids);

		expect(uniqueIds.size).toBe(ids.length);
	});
});

describe('mergeSmallChunks', () => {
	function makeChunk(content: string, startIndex: number = 0): DocumentChunk {
		return {
			id: `chunk-${content.slice(0, 10)}`,
			documentId: 'doc-1',
			content,
			startIndex,
			endIndex: startIndex + content.length
		};
	}

	it('returns empty array for empty input', () => {
		expect(mergeSmallChunks([])).toEqual([]);
	});

	it('returns single chunk unchanged', () => {
		const chunks = [makeChunk('Single chunk content.')];
		const result = mergeSmallChunks(chunks);

		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('Single chunk content.');
	});

	it('merges adjacent small chunks', () => {
		const chunks = [
			makeChunk('Small.', 0),
			makeChunk('Also small.', 10)
		];
		const result = mergeSmallChunks(chunks, 200);

		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('Small.\n\nAlso small.');
	});

	it('does not merge chunks that exceed minSize together', () => {
		const chunks = [
			makeChunk('A'.repeat(100), 0),
			makeChunk('B'.repeat(100), 100)
		];
		const result = mergeSmallChunks(chunks, 150);

		expect(result).toHaveLength(2);
	});

	it('preserves startIndex from first chunk and endIndex from last when merging', () => {
		const chunks = [
			makeChunk('First chunk.', 0),
			makeChunk('Second chunk.', 15)
		];
		const result = mergeSmallChunks(chunks, 200);

		expect(result).toHaveLength(1);
		expect(result[0].startIndex).toBe(0);
		expect(result[0].endIndex).toBe(15 + 'Second chunk.'.length);
	});
});
