<script lang="ts">
	/**
	 * CodeBlock - Syntax highlighted code with copy button and execution
	 * Uses Shiki for highlighting with a dark theme
	 * Supports running JavaScript and Python code in the browser
	 */

	import { codeToHtml, type BundledLanguage } from 'shiki';
	import { executionManager, isExecutable, getRuntime } from '$lib/execution';
	import type { ExecutionResult, ExecutionOutput } from '$lib/execution';
	import { toastState } from '$lib/stores';

	interface Props {
		code: string;
		language?: string;
		/** Whether to show the run button for executable code */
		showRunButton?: boolean;
		/** Skip syntax highlighting during streaming to prevent layout shifts */
		isStreaming?: boolean;
	}

	const { code, language = 'text', showRunButton = true, isStreaming = false }: Props = $props();

	// State for highlighted HTML and copy feedback
	let highlightedHtml = $state('');
	let isLoading = $state(true);
	let copied = $state(false);

	// Execution state
	let isExecuting = $state(false);
	let executionResult = $state<ExecutionResult | null>(null);
	let showOutput = $state(false);

	// Check if this code block is executable
	const canExecute = $derived(showRunButton && isExecutable(language) && executionManager.canExecute(language));

	// Map common language aliases
	const languageMap: Record<string, string> = {
		js: 'javascript',
		ts: 'typescript',
		py: 'python',
		rb: 'ruby',
		sh: 'bash',
		shell: 'bash',
		yml: 'yaml',
		md: 'markdown',
		json5: 'json',
		plaintext: 'text',
		txt: 'text'
	};

	/**
	 * Get the normalized language identifier
	 */
	function getNormalizedLanguage(lang: string): string {
		const normalized = lang.toLowerCase().trim();
		return languageMap[normalized] || normalized;
	}

	/**
	 * Highlight code using Shiki
	 */
	async function highlightCode(): Promise<void> {
		isLoading = true;

		try {
			const normalizedLang = getNormalizedLanguage(language);

			const html = await codeToHtml(code, {
				lang: normalizedLang as BundledLanguage,
				theme: 'github-dark'
			});

			highlightedHtml = html;
		} catch (error) {
			// Fallback to plain text if language not supported
			console.warn(`Language "${language}" not supported, falling back to plain text`);

			try {
				const html = await codeToHtml(code, {
					lang: 'text',
					theme: 'github-dark'
				});
				highlightedHtml = html;
			} catch {
				// Ultimate fallback - just escape and wrap
				highlightedHtml = `<pre class="shiki github-dark"><code>${escapeHtml(code)}</code></pre>`;
			}
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Escape HTML special characters
	 */
	function escapeHtml(text: string): string {
		const htmlEscapes: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		};
		return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
	}

	/**
	 * Copy code to clipboard
	 */
	async function handleCopy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (error) {
			toastState.error('Failed to copy code');
		}
	}

	/**
	 * Execute the code
	 */
	async function handleRun(): Promise<void> {
		if (!canExecute || isExecuting) return;

		isExecuting = true;
		showOutput = true;
		executionResult = null;

		try {
			executionResult = await executionManager.executeByLanguage(code, language);
		} catch (error) {
			executionResult = {
				status: 'error',
				outputs: [{
					type: 'error',
					content: error instanceof Error ? error.message : String(error),
					timestamp: 0
				}],
				duration: 0,
				error: error instanceof Error ? error.message : String(error)
			};
		} finally {
			isExecuting = false;
		}
	}

	/**
	 * Cancel execution
	 */
	function handleCancel(): void {
		const runtime = getRuntime(language);
		if (runtime) {
			executionManager.cancel(runtime);
		}
		isExecuting = false;
	}

	/**
	 * Toggle output visibility
	 */
	function toggleOutput(): void {
		showOutput = !showOutput;
	}

	/**
	 * Clear execution output
	 */
	function clearOutput(): void {
		executionResult = null;
		showOutput = false;
	}

	/**
	 * Get output class based on type
	 */
	function getOutputClass(type: ExecutionOutput['type']): string {
		switch (type) {
			case 'stdout':
				return 'text-gray-300';
			case 'stderr':
				return 'text-yellow-400';
			case 'error':
				return 'text-red-400';
			case 'result':
				return 'text-green-400';
			default:
				return 'text-gray-400';
		}
	}

	// Highlight code when component mounts or code/language changes
	// Skip highlighting during streaming to prevent layout shifts
	$effect(() => {
		// Access reactive dependencies
		const _ = [code, language, isStreaming];

		if (isStreaming) {
			// During streaming, just show plain code
			isLoading = true;
			return;
		}

		// Only highlight when not streaming
		highlightCode();
	});
</script>

<div class="group relative overflow-hidden rounded-xl border border-slate-700/50" style="contain: layout;">
	<!-- Header with language label, run button, and copy button -->
	<div
		class="flex items-center justify-between border-b border-slate-700/50 bg-slate-800 px-3 py-1.5 text-xs text-slate-400"
	>
		<span class="font-mono uppercase">{language}</span>
		<div class="flex items-center gap-2">
			<!-- Run button (for executable languages) -->
			{#if canExecute}
				{#if isExecuting}
					<button
						type="button"
						onclick={handleCancel}
						class="flex items-center gap-1 rounded bg-red-600/20 px-2 py-1 text-red-400 transition-colors hover:bg-red-600/30"
						aria-label="Cancel execution"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
							<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" />
						</svg>
						<span>Stop</span>
					</button>
				{:else}
					<button
						type="button"
						onclick={handleRun}
						class="flex items-center gap-1 rounded bg-emerald-600/20 px-2 py-1 text-emerald-400 transition-colors hover:bg-emerald-600/30"
						aria-label="Run code"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
							<path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
						</svg>
						<span>Run</span>
					</button>
				{/if}
			{/if}

			<!-- Copy button -->
			<button
				type="button"
				onclick={handleCopy}
				class="flex items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-theme-tertiary hover:text-theme-primary"
				aria-label={copied ? 'Copied!' : 'Copy code'}
			>
				{#if copied}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-4 w-4 text-green-400"
					>
						<path
							fill-rule="evenodd"
							d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
							clip-rule="evenodd"
						/>
					</svg>
					<span class="text-green-400">Copied!</span>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-4 w-4"
					>
						<path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
						<path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
					</svg>
					<span>Copy</span>
				{/if}
			</button>
		</div>
	</div>

	<!-- Code content - use same styling for loading/loaded to prevent layout shift -->
	<div class="code-block-content overflow-x-auto bg-[#0d1117]">
		{#if isLoading}
			<pre class="m-0 overflow-x-auto bg-transparent px-4 py-3" style="line-height: 1.5;"><code class="font-mono text-[13px] text-slate-300" style="line-height: inherit;">{code}</code></pre>
		{:else}
			{@html highlightedHtml}
		{/if}
	</div>

	<!-- Execution output -->
	{#if showOutput && (isExecuting || executionResult)}
		<div class="border-t border-slate-700/50 bg-slate-800/80">
			<!-- Output header -->
			<div class="flex items-center justify-between px-3 py-2">
				<div class="flex items-center gap-2">
					<!-- Terminal icon -->
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-slate-400">
						<path fill-rule="evenodd" d="M3.25 3A2.25 2.25 0 001 5.25v9.5A2.25 2.25 0 003.25 17h13.5A2.25 2.25 0 0019 14.75v-9.5A2.25 2.25 0 0016.75 3H3.25zm.943 8.752a.75.75 0 01.055-1.06L6.128 9l-1.88-1.693a.75.75 0 111.004-1.114l2.5 2.25a.75.75 0 010 1.114l-2.5 2.25a.75.75 0 01-1.06-.055zM9.75 10.25a.75.75 0 000 1.5h2.5a.75.75 0 000-1.5h-2.5z" clip-rule="evenodd" />
					</svg>
					<span class="text-xs font-medium text-slate-400">Output</span>

					{#if isExecuting}
						<span class="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-400">
							<svg class="h-3 w-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Running
						</span>
					{:else if executionResult}
						{#if executionResult.status === 'success'}
							<span class="text-[11px] text-slate-500">Completed</span>
						{:else}
							<span class="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3">
									<path fill-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
								</svg>
								Error
							</span>
						{/if}
						<span class="text-[11px] text-slate-500">{executionResult.duration}ms</span>
					{/if}
				</div>
				<button
					type="button"
					onclick={clearOutput}
					class="rounded-md px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
					aria-label="Clear output"
				>
					Clear
				</button>
			</div>

			<!-- Output content -->
			<div class="max-h-48 overflow-auto border-t border-slate-700/50 bg-[#0d1117] px-3 py-2">
				{#if executionResult?.outputs.length}
					<pre class="font-mono text-[12px] leading-relaxed">{#each executionResult.outputs as output}<span class={getOutputClass(output.type)}>{output.content}</span>{/each}</pre>
				{:else if !isExecuting}
					<p class="text-[12px] italic text-slate-500">No output</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Override Shiki styles for compact, polished appearance */
	.code-block-content :global(pre) {
		@apply m-0 overflow-x-auto bg-transparent px-4 py-3;
		line-height: 1.5;
	}

	.code-block-content :global(code) {
		@apply font-mono text-[13px];
		line-height: inherit;
	}

	/* Shiki wraps each line - make them inline to prevent double spacing */
	.code-block-content :global(.line) {
		display: inline;
	}

	/* Scrollbar styling for code blocks */
	.code-block-content :global(pre)::-webkit-scrollbar {
		height: 6px;
	}

	.code-block-content :global(pre)::-webkit-scrollbar-track {
		@apply bg-transparent;
	}

	/* Light mode scrollbar */
	.code-block-content :global(pre)::-webkit-scrollbar-thumb {
		@apply rounded-full bg-slate-400/50;
	}

	.code-block-content :global(pre)::-webkit-scrollbar-thumb:hover {
		@apply bg-slate-500/70;
	}

	/* Dark mode scrollbar */
	:global(.dark) .code-block-content :global(pre)::-webkit-scrollbar-thumb {
		@apply bg-slate-600/50;
	}

	:global(.dark) .code-block-content :global(pre)::-webkit-scrollbar-thumb:hover {
		@apply bg-slate-500/70;
	}
</style>
