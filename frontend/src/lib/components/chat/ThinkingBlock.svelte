<script lang="ts">
	/**
	 * ThinkingBlock.svelte - Collapsible display for model reasoning/thinking
	 * Shows thinking content in a muted, collapsed-by-default section
	 * User can expand/collapse at any time, including while thinking is in progress
	 */
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	interface Props {
		content: string;
		defaultExpanded?: boolean;
		/** Whether thinking is currently streaming */
		inProgress?: boolean;
	}

	const { content, defaultExpanded = false, inProgress = false }: Props = $props();

	let isExpanded = $state(defaultExpanded);

	// Keep collapsed during and after streaming - user can expand manually if desired

	/**
	 * Render markdown to sanitized HTML
	 */
	function renderMarkdown(text: string): string {
		const html = marked.parse(text, {
			async: false,
			gfm: true,
			breaks: true
		}) as string;

		return DOMPurify.sanitize(html, {
			USE_PROFILES: { html: true },
			ALLOWED_TAGS: [
				'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
				'ul', 'ol', 'li', 'code', 'pre', 'blockquote'
			],
			ALLOWED_ATTR: []
		});
	}

	function toggle() {
		isExpanded = !isExpanded;
	}
</script>

<div class="my-3 rounded-lg border border-amber-900/30 bg-amber-950/20 {inProgress ? 'ring-1 ring-amber-500/30' : ''}">
	<!-- Header with toggle -->
	<button
		type="button"
		onclick={toggle}
		class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-amber-400/80 transition-colors hover:bg-amber-900/20"
	>
		<!-- Expand/Collapse chevron -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-4 w-4 transition-transform {isExpanded ? 'rotate-90' : ''}"
		>
			<path
				fill-rule="evenodd"
				d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
				clip-rule="evenodd"
			/>
		</svg>

		<!-- Thinking indicator with optional spinner -->
		<span class="flex items-center gap-1.5">
			{#if inProgress}
				<!-- Animated spinner -->
				<svg
					class="h-3.5 w-3.5 animate-spin text-amber-400"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
			{:else}
				<span>🧠</span>
			{/if}
			<span class="font-medium">
				{#if inProgress}
					Thinking...
				{:else}
					Reasoning
				{/if}
			</span>
		</span>

		<span class="text-amber-500/50">
			{isExpanded ? 'Click to collapse' : 'Click to expand'}
		</span>
	</button>

	<!-- Thinking content (collapsible) -->
	{#if isExpanded}
		<div class="border-t border-amber-900/30 px-3 py-2">
			<div class="thinking-content prose prose-sm prose-invert prose-amber max-w-none text-sm text-amber-200/70">
				{@html renderMarkdown(content)}
				{#if inProgress}
					<span class="thinking-cursor"></span>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Blinking cursor for streaming */
	.thinking-cursor {
		display: inline-block;
		width: 2px;
		height: 1em;
		background-color: rgb(251 191 36 / 0.7);
		margin-left: 2px;
		vertical-align: text-bottom;
		animation: blink 1s step-end infinite;
	}

	@keyframes blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	/* Prose styling for thinking content */
	.thinking-content :global(p) {
		margin: 0.5rem 0;
	}

	.thinking-content :global(p:first-child) {
		margin-top: 0;
	}

	.thinking-content :global(p:last-child) {
		margin-bottom: 0;
	}
</style>
