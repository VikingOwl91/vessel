/**
 * Prompt resolution service tests
 *
 * Tests the pure utility functions from prompt resolution
 */

import { describe, it, expect } from 'vitest';
import { getPromptSourceLabel, type PromptSource } from './prompt-resolution';

describe('getPromptSourceLabel', () => {
	const testCases: Array<{ source: PromptSource; expected: string }> = [
		{ source: 'per-conversation', expected: 'Custom (this chat)' },
		{ source: 'new-chat-selection', expected: 'Selected prompt' },
		{ source: 'model-mapping', expected: 'Model default' },
		{ source: 'model-embedded', expected: 'Model built-in' },
		{ source: 'capability-match', expected: 'Auto-matched' },
		{ source: 'global-active', expected: 'Global default' },
		{ source: 'none', expected: 'None' }
	];

	testCases.forEach(({ source, expected }) => {
		it(`returns "${expected}" for source "${source}"`, () => {
			expect(getPromptSourceLabel(source)).toBe(expected);
		});
	});

	it('covers all prompt source types', () => {
		// This ensures we test all PromptSource values
		const allSources: PromptSource[] = [
			'per-conversation',
			'new-chat-selection',
			'model-mapping',
			'model-embedded',
			'capability-match',
			'global-active',
			'none'
		];

		allSources.forEach((source) => {
			const label = getPromptSourceLabel(source);
			expect(typeof label).toBe('string');
			expect(label.length).toBeGreaterThan(0);
		});
	});
});
