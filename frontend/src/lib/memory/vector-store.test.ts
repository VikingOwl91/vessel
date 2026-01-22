/**
 * Vector store utility tests
 *
 * Tests the pure utility functions
 */

import { describe, it, expect } from 'vitest';
import { formatResultsAsContext } from './vector-store';
import type { SearchResult } from './vector-store';
import type { StoredChunk, StoredDocument } from '$lib/storage/db';

// Helper to create mock search results
function createSearchResult(
	documentName: string,
	chunkContent: string,
	similarity: number
): SearchResult {
	const doc: StoredDocument = {
		id: 'doc-' + Math.random().toString(36).slice(2),
		name: documentName,
		mimeType: 'text/plain',
		size: chunkContent.length,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		chunkCount: 1,
		embeddingModel: 'nomic-embed-text',
		projectId: null,
		embeddingStatus: 'ready'
	};

	const chunk: StoredChunk = {
		id: 'chunk-' + Math.random().toString(36).slice(2),
		documentId: doc.id,
		content: chunkContent,
		embedding: [],
		startIndex: 0,
		endIndex: chunkContent.length,
		tokenCount: Math.ceil(chunkContent.split(' ').length * 1.3)
	};

	return { chunk, document: doc, similarity };
}

describe('formatResultsAsContext', () => {
	it('formats single result correctly', () => {
		const results = [createSearchResult('README.md', 'This is the content.', 0.9)];

		const context = formatResultsAsContext(results);

		expect(context).toContain('Relevant context from knowledge base:');
		expect(context).toContain('[Source 1: README.md]');
		expect(context).toContain('This is the content.');
	});

	it('formats multiple results with separators', () => {
		const results = [
			createSearchResult('doc1.txt', 'First document content', 0.95),
			createSearchResult('doc2.txt', 'Second document content', 0.85),
			createSearchResult('doc3.txt', 'Third document content', 0.75)
		];

		const context = formatResultsAsContext(results);

		expect(context).toContain('[Source 1: doc1.txt]');
		expect(context).toContain('[Source 2: doc2.txt]');
		expect(context).toContain('[Source 3: doc3.txt]');
		expect(context).toContain('First document content');
		expect(context).toContain('Second document content');
		expect(context).toContain('Third document content');
		// Check for separators between results
		expect(context.split('---').length).toBe(3);
	});

	it('returns empty string for empty results', () => {
		const context = formatResultsAsContext([]);

		expect(context).toBe('');
	});

	it('preserves special characters in content', () => {
		const results = [
			createSearchResult('code.js', 'function test() { return "hello"; }', 0.9)
		];

		const context = formatResultsAsContext(results);

		expect(context).toContain('function test() { return "hello"; }');
	});

	it('includes document names in source references', () => {
		const results = [
			createSearchResult('path/to/file.md', 'Some content', 0.9)
		];

		const context = formatResultsAsContext(results);

		expect(context).toContain('[Source 1: path/to/file.md]');
	});

	it('numbers sources sequentially', () => {
		const results = [
			createSearchResult('a.txt', 'Content A', 0.9),
			createSearchResult('b.txt', 'Content B', 0.8),
			createSearchResult('c.txt', 'Content C', 0.7),
			createSearchResult('d.txt', 'Content D', 0.6),
			createSearchResult('e.txt', 'Content E', 0.5)
		];

		const context = formatResultsAsContext(results);

		expect(context).toContain('[Source 1: a.txt]');
		expect(context).toContain('[Source 2: b.txt]');
		expect(context).toContain('[Source 3: c.txt]');
		expect(context).toContain('[Source 4: d.txt]');
		expect(context).toContain('[Source 5: e.txt]');
	});

	it('handles multiline content', () => {
		const results = [
			createSearchResult('notes.txt', 'Line 1\nLine 2\nLine 3', 0.9)
		];

		const context = formatResultsAsContext(results);

		expect(context).toContain('Line 1\nLine 2\nLine 3');
	});
});
