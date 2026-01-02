<script lang="ts">
	/**
	 * ToolTester - Test panel for running tools with sample inputs
	 */

	import type { JSONSchema, ToolImplementation } from '$lib/tools';
	import CodeEditor from './CodeEditor.svelte';

	interface Props {
		implementation: ToolImplementation;
		code: string;
		parameters: JSONSchema;
		isOpen?: boolean;
		onclose?: () => void;
	}

	const { implementation, code, parameters, isOpen = false, onclose }: Props = $props();

	let testInput = $state('{}');
	let testResult = $state<{ success: boolean; result?: unknown; error?: string } | null>(null);
	let isRunning = $state(false);

	// Generate example input from parameters
	$effect(() => {
		if (isOpen && testInput === '{}' && parameters.properties) {
			const example: Record<string, unknown> = {};
			for (const [name, prop] of Object.entries(parameters.properties)) {
				switch (prop.type) {
					case 'string':
						example[name] = prop.description ? `example_${name}` : '';
						break;
					case 'number':
						example[name] = 0;
						break;
					case 'boolean':
						example[name] = false;
						break;
					case 'array':
						example[name] = [];
						break;
					case 'object':
						example[name] = {};
						break;
				}
			}
			if (Object.keys(example).length > 0) {
				testInput = JSON.stringify(example, null, 2);
			}
		}
	});

	async function runTest(): Promise<void> {
		if (isRunning) return;

		isRunning = true;
		testResult = null;

		try {
			// Parse the input
			let args: Record<string, unknown>;
			try {
				args = JSON.parse(testInput);
			} catch {
				testResult = { success: false, error: 'Invalid JSON input' };
				isRunning = false;
				return;
			}

			if (implementation === 'javascript') {
				// Execute JavaScript directly in browser
				try {
					// eslint-disable-next-line @typescript-eslint/no-implied-eval
					const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
					const fn = new AsyncFunction(
						'args',
						`
						"use strict";
						${code}
					`
					);
					const result = await fn(args);
					testResult = { success: true, result };
				} catch (error) {
					testResult = {
						success: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			} else if (implementation === 'python') {
				// Python requires backend execution
				try {
					const response = await fetch('/api/v1/tools/execute', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							language: 'python',
							code,
							args,
							timeout: 30
						})
					});

					if (!response.ok) {
						throw new Error(`Server error: ${response.status}`);
					}

					const data = await response.json();
					if (data.success) {
						testResult = { success: true, result: data.result };
					} else {
						testResult = { success: false, error: data.error || 'Unknown error' };
					}
				} catch (error) {
					testResult = {
						success: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			} else {
				testResult = { success: false, error: 'HTTP tools cannot be tested in the editor' };
			}
		} finally {
			isRunning = false;
		}
	}

	function formatResult(result: unknown): string {
		if (result === undefined) return 'undefined';
		if (result === null) return 'null';
		try {
			return JSON.stringify(result, null, 2);
		} catch {
			return String(result);
		}
	}
</script>

{#if isOpen}
	<div class="rounded-lg border border-theme-subtle bg-theme-tertiary/50 p-4 mt-4">
		<div class="flex items-center justify-between mb-3">
			<h4 class="text-sm font-medium text-theme-primary flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
				</svg>
				Test Tool
			</h4>
			{#if onclose}
				<button
					type="button"
					onclick={onclose}
					class="text-theme-muted hover:text-theme-primary"
					aria-label="Close test panel"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
					</svg>
				</button>
			{/if}
		</div>

		<div class="space-y-4">
			<!-- Input -->
			<div>
				<label class="block text-xs font-medium text-theme-secondary mb-1">Input Arguments (JSON)</label>
				<CodeEditor bind:value={testInput} language="json" minHeight="80px" />
			</div>

			<!-- Run button -->
			<button
				type="button"
				onclick={runTest}
				disabled={isRunning || !code.trim()}
				class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if isRunning}
					<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					Running...
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
					</svg>
					Run Test
				{/if}
			</button>

			<!-- Result -->
			{#if testResult}
				<div>
					<label class="block text-xs font-medium text-theme-secondary mb-1">Result</label>
					<div
						class="rounded-lg p-3 text-sm font-mono overflow-x-auto {testResult.success
							? 'bg-emerald-900/30 border border-emerald-500/30'
							: 'bg-red-900/30 border border-red-500/30'}"
					>
						{#if testResult.success}
							<div class="flex items-center gap-2 text-emerald-400 mb-2">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
								</svg>
								Success
							</div>
							<pre class="text-theme-primary whitespace-pre-wrap">{formatResult(testResult.result)}</pre>
						{:else}
							<div class="flex items-center gap-2 text-red-400 mb-2">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
								</svg>
								Error
							</div>
							<pre class="text-red-300 whitespace-pre-wrap">{testResult.error}</pre>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
