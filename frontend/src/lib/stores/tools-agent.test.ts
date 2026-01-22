/**
 * Tool definitions for agents - integration tests
 *
 * Tests getToolDefinitionsForAgent functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] || null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		}
	};
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Import after mocks are set up
let toolsState: typeof import('./tools.svelte.js').toolsState;

describe('getToolDefinitionsForAgent', () => {
	beforeEach(async () => {
		localStorageMock.clear();
		vi.resetModules();

		// Set up default tool enabled state (all tools enabled)
		localStorageMock.setItem('toolsEnabled', 'true');
		localStorageMock.setItem(
			'enabledTools',
			JSON.stringify({
				fetch_url: true,
				web_search: true,
				calculate: true,
				get_location: true,
				get_current_time: true
			})
		);

		const module = await import('./tools.svelte.js');
		toolsState = module.toolsState;
	});

	it('returns empty array when toolsEnabled is false', async () => {
		toolsState.toolsEnabled = false;

		const result = toolsState.getToolDefinitionsForAgent(['fetch_url', 'calculate']);

		expect(result).toEqual([]);
	});

	it('returns only tools matching enabledToolNames', async () => {
		const result = toolsState.getToolDefinitionsForAgent(['fetch_url', 'calculate']);

		expect(result.length).toBe(2);
		const names = result.map((t) => t.function.name).sort();
		expect(names).toEqual(['calculate', 'fetch_url']);
	});

	it('includes both builtin and custom tools', async () => {
		// Add a custom tool
		toolsState.addCustomTool({
			name: 'my_custom_tool',
			description: 'A custom tool',
			implementation: 'javascript',
			code: 'return args;',
			parameters: {
				type: 'object',
				properties: {
					input: { type: 'string' }
				},
				required: ['input']
			},
			enabled: true
		});

		const result = toolsState.getToolDefinitionsForAgent([
			'fetch_url',
			'my_custom_tool'
		]);

		expect(result.length).toBe(2);
		const names = result.map((t) => t.function.name).sort();
		expect(names).toEqual(['fetch_url', 'my_custom_tool']);
	});

	it('returns empty array for empty enabledToolNames', async () => {
		const result = toolsState.getToolDefinitionsForAgent([]);

		expect(result).toEqual([]);
	});

	it('ignores tool names that do not exist', async () => {
		const result = toolsState.getToolDefinitionsForAgent([
			'fetch_url',
			'nonexistent_tool',
			'calculate'
		]);

		expect(result.length).toBe(2);
		const names = result.map((t) => t.function.name).sort();
		expect(names).toEqual(['calculate', 'fetch_url']);
	});

	it('respects tool enabled state for included tools', async () => {
		// Disable calculate tool
		toolsState.setToolEnabled('calculate', false);

		const result = toolsState.getToolDefinitionsForAgent(['fetch_url', 'calculate']);

		// calculate is disabled, so it should not be included
		expect(result.length).toBe(1);
		expect(result[0].function.name).toBe('fetch_url');
	});

	it('returns all tools when null is passed (no agent)', async () => {
		const withAgent = toolsState.getToolDefinitionsForAgent(['fetch_url']);
		const withoutAgent = toolsState.getToolDefinitionsForAgent(null);

		expect(withAgent.length).toBe(1);
		expect(withoutAgent.length).toBeGreaterThan(1);
	});
});
