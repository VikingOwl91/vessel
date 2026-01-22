/**
 * Embeddings utility tests
 *
 * Tests the pure vector math functions
 */

import { describe, it, expect } from 'vitest';
import {
	cosineSimilarity,
	findSimilar,
	normalizeVector,
	getEmbeddingDimension
} from './embeddings';

describe('cosineSimilarity', () => {
	it('returns 1 for identical vectors', () => {
		const v = [1, 2, 3];
		expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
	});

	it('returns -1 for opposite vectors', () => {
		const a = [1, 2, 3];
		const b = [-1, -2, -3];
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
	});

	it('returns 0 for orthogonal vectors', () => {
		const a = [1, 0];
		const b = [0, 1];
		expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
	});

	it('handles normalized vectors', () => {
		const a = [0.6, 0.8];
		const b = [0.8, 0.6];
		const sim = cosineSimilarity(a, b);
		expect(sim).toBeGreaterThan(0);
		expect(sim).toBeLessThan(1);
		expect(sim).toBeCloseTo(0.96, 2);
	});

	it('throws for mismatched dimensions', () => {
		const a = [1, 2, 3];
		const b = [1, 2];
		expect(() => cosineSimilarity(a, b)).toThrow("Vector dimensions don't match");
	});

	it('returns 0 for zero vectors', () => {
		const a = [0, 0, 0];
		const b = [1, 2, 3];
		expect(cosineSimilarity(a, b)).toBe(0);
	});

	it('handles large vectors', () => {
		const size = 768;
		const a = Array(size)
			.fill(0)
			.map(() => Math.random());
		const b = Array(size)
			.fill(0)
			.map(() => Math.random());
		const sim = cosineSimilarity(a, b);
		expect(sim).toBeGreaterThanOrEqual(-1);
		expect(sim).toBeLessThanOrEqual(1);
	});
});

describe('normalizeVector', () => {
	it('converts to unit vector', () => {
		const v = [3, 4];
		const normalized = normalizeVector(v);

		// Check it's a unit vector
		const magnitude = Math.sqrt(normalized.reduce((sum, x) => sum + x * x, 0));
		expect(magnitude).toBeCloseTo(1, 10);
	});

	it('preserves direction', () => {
		const v = [3, 4];
		const normalized = normalizeVector(v);

		expect(normalized[0]).toBeCloseTo(0.6, 10);
		expect(normalized[1]).toBeCloseTo(0.8, 10);
	});

	it('handles zero vector', () => {
		const v = [0, 0, 0];
		const normalized = normalizeVector(v);

		expect(normalized).toEqual([0, 0, 0]);
	});

	it('handles already-normalized vector', () => {
		const v = [0.6, 0.8];
		const normalized = normalizeVector(v);

		expect(normalized[0]).toBeCloseTo(0.6, 10);
		expect(normalized[1]).toBeCloseTo(0.8, 10);
	});

	it('handles negative values', () => {
		const v = [-3, 4];
		const normalized = normalizeVector(v);

		expect(normalized[0]).toBeCloseTo(-0.6, 10);
		expect(normalized[1]).toBeCloseTo(0.8, 10);
	});
});

describe('findSimilar', () => {
	const candidates = [
		{ id: 1, embedding: [1, 0, 0] },
		{ id: 2, embedding: [0.9, 0.1, 0] },
		{ id: 3, embedding: [0, 1, 0] },
		{ id: 4, embedding: [0, 0, 1] },
		{ id: 5, embedding: [-1, 0, 0] }
	];

	it('returns most similar items', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, candidates, 3, 0);

		expect(results.length).toBe(3);
		expect(results[0].id).toBe(1); // Exact match
		expect(results[1].id).toBe(2); // Very similar
		expect(results[0].similarity).toBeCloseTo(1, 5);
	});

	it('respects threshold', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, candidates, 10, 0.8);

		// Only items with similarity >= 0.8
		expect(results.every((r) => r.similarity >= 0.8)).toBe(true);
	});

	it('respects topK limit', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, candidates, 2, 0);

		expect(results.length).toBe(2);
	});

	it('returns empty array for no matches above threshold', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, candidates, 10, 0.999);

		// Only exact match should pass 0.999 threshold
		expect(results.length).toBe(1);
	});

	it('handles empty candidates', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, [], 5, 0);

		expect(results).toEqual([]);
	});

	it('sorts by similarity descending', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, candidates, 5, -1);

		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
		}
	});

	it('adds similarity property to results', () => {
		const query = [1, 0, 0];
		const results = findSimilar(query, candidates, 1, 0);

		expect(results[0]).toHaveProperty('similarity');
		expect(typeof results[0].similarity).toBe('number');
		expect(results[0]).toHaveProperty('id');
		expect(results[0]).toHaveProperty('embedding');
	});
});

describe('getEmbeddingDimension', () => {
	it('returns correct dimensions for known models', () => {
		expect(getEmbeddingDimension('nomic-embed-text')).toBe(768);
		expect(getEmbeddingDimension('mxbai-embed-large')).toBe(1024);
		expect(getEmbeddingDimension('all-minilm')).toBe(384);
		expect(getEmbeddingDimension('snowflake-arctic-embed')).toBe(1024);
		expect(getEmbeddingDimension('embeddinggemma:latest')).toBe(768);
		expect(getEmbeddingDimension('embeddinggemma')).toBe(768);
	});

	it('returns default 768 for unknown models', () => {
		expect(getEmbeddingDimension('unknown-model')).toBe(768);
		expect(getEmbeddingDimension('')).toBe(768);
		expect(getEmbeddingDimension('custom-embed-model')).toBe(768);
	});
});
