<script lang="ts">
	/**
	 * MessageContent - Renders markdown content with code highlighting
	 * Parses markdown, sanitizes HTML, extracts code blocks, and displays images
	 */

	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import CodeBlock from './CodeBlock.svelte';
	import HtmlPreview from './HtmlPreview.svelte';
	import ToolResultDisplay from './ToolResultDisplay.svelte';
	import ThinkingBlock from './ThinkingBlock.svelte';
	import { base64ToDataUrl } from '$lib/ollama/image-processor';

	interface Props {
		content: string;
		images?: string[];
		isStreaming?: boolean;
		/** Whether to show thinking blocks (hide when thinking mode is disabled) */
		showThinking?: boolean;
	}

	const { content, images, isStreaming = false, showThinking = true }: Props = $props();

	// Pattern to find fenced code blocks
	const CODE_BLOCK_PATTERN = /```(\w+)?\n([\s\S]*?)```/g;

	// Pattern to find thinking blocks (used by reasoning models)
	// Supports both <thinking>...</thinking> and <think>...</think> (qwen3 format)
	const THINKING_PATTERN = /<(?:thinking|think)>([\s\S]*?)<\/(?:thinking|think)>/g;

	// Pattern to detect JSON tool call objects (for models that output them as text)
	// Matches: {"name": "...", "arguments": {...}}
	const JSON_TOOL_CALL_PATTERN = /^(\s*\{[\s\S]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*\}\s*\}\s*)$/;

	// Pattern to detect tool results in various formats
	const TOOL_RESULT_PATTERN = /Tool result:\s*(\{[\s\S]*?\}|\S[\s\S]*?)(?=\n\n|$)/;
	const TOOL_ERROR_PATTERN = /Tool error:\s*(.+?)(?=\n\n|$)/;

	// Pattern for "Called tool:" text (redundant with ToolCallDisplay)
	const CALLED_TOOL_PATTERN = /Called tool:\s*\w+\([^)]*\)\s*\n*/g;

	// Pattern for "Tool execution results:" header
	const TOOL_EXEC_HEADER_PATTERN = /Tool execution results:\s*\n?/g;

	// Languages that should show a preview
	const PREVIEW_LANGUAGES = ['html', 'htm'];

	interface ContentPart {
		type: 'text' | 'code' | 'tool-result' | 'thinking';
		content: string;
		language?: string;
		showPreview?: boolean;
	}

	/** Check if a language should show preview */
	function shouldShowPreview(language: string): boolean {
		return PREVIEW_LANGUAGES.includes(language.toLowerCase());
	}

	/** Modal state for full-size image viewing */
	let modalImage = $state<string | null>(null);

	/**
	 * Clean redundant tool text (shown via ToolCallDisplay)
	 */
	function cleanToolText(text: string): string {
		return text
			.replace(CALLED_TOOL_PATTERN, '')
			.replace(TOOL_EXEC_HEADER_PATTERN, '')
			.replace(/^Based on these results.*$/gm, '')
			.trim();
	}

	/**
	 * Check if text contains tool execution results
	 */
	function containsToolResult(text: string): boolean {
		return text.includes('Tool execution results:') || text.includes('Tool result:') || text.includes('Tool error:');
	}

	/**
	 * Check if text is a JSON tool call (for models that output them as text)
	 */
	function isJsonToolCall(text: string): boolean {
		const trimmed = text.trim();
		if (!trimmed.startsWith('{')) return false;
		try {
			const parsed = JSON.parse(trimmed);
			return typeof parsed === 'object' &&
				'name' in parsed &&
				'arguments' in parsed &&
				typeof parsed.name === 'string' &&
				typeof parsed.arguments === 'object';
		} catch {
			return false;
		}
	}

	/**
	 * Parse a text section for tool results
	 */
	function parseTextForToolResults(text: string): ContentPart[] {
		const parts: ContentPart[] = [];

		// Check for tool execution results pattern
		const toolMatch = text.match(TOOL_RESULT_PATTERN);
		if (toolMatch) {
			const beforeTool = text.slice(0, toolMatch.index);
			const toolContent = toolMatch[1];
			const afterTool = text.slice((toolMatch.index || 0) + toolMatch[0].length);

			if (beforeTool.trim()) {
				parts.push({ type: 'text', content: beforeTool });
			}
			parts.push({ type: 'tool-result', content: toolContent });
			if (afterTool.trim()) {
				// Recursively parse remaining content
				parts.push(...parseTextForToolResults(afterTool));
			}
			return parts;
		}

		// No tool result found, return as text
		if (text.trim()) {
			parts.push({ type: 'text', content: text });
		}
		return parts;
	}

	/**
	 * Extract thinking blocks and return remaining text
	 * Handles both complete and unclosed (streaming) thinking blocks
	 */
	function extractThinkingBlocks(text: string): { thinkingParts: ContentPart[]; remainingText: string; isThinkingInProgress: boolean } {
		const thinkingParts: ContentPart[] = [];
		THINKING_PATTERN.lastIndex = 0;

		let remainingText = text;
		let match;
		let isThinkingInProgress = false;

		// Find all complete thinking blocks
		while ((match = THINKING_PATTERN.exec(text)) !== null) {
			thinkingParts.push({
				type: 'thinking',
				content: match[1].trim()
			});
		}

		// Remove complete thinking blocks from text
		remainingText = text.replace(THINKING_PATTERN, '').trim();

		// Check for unclosed thinking block during streaming
		// Pattern: starts with <think> but no closing tag
		const unclosedPattern = /^<(?:thinking|think)>([\s\S]*)$/;
		const unclosedMatch = remainingText.match(unclosedPattern);
		if (unclosedMatch && isStreaming) {
			// This is an in-progress thinking block
			thinkingParts.push({
				type: 'thinking',
				content: unclosedMatch[1].trim()
			});
			remainingText = '';
			isThinkingInProgress = true;
		}

		return { thinkingParts, remainingText, isThinkingInProgress };
	}

	/**
	 * Parse content into parts (text, code blocks, thinking, and tool results)
	 */
	function parseContent(text: string): { parts: ContentPart[]; isThinkingInProgress: boolean } {
		const parts: ContentPart[] = [];

		// First, extract thinking blocks (they should appear at the top)
		const { thinkingParts, remainingText, isThinkingInProgress } = extractThinkingBlocks(text);

		// Add thinking parts first
		parts.push(...thinkingParts);

		// Now parse the remaining text for code blocks and tool results
		let lastIndex = 0;

		// Reset regex state
		CODE_BLOCK_PATTERN.lastIndex = 0;

		// Find all code blocks
		let match;
		while ((match = CODE_BLOCK_PATTERN.exec(remainingText)) !== null) {
			// Add text before this code block (may contain tool results or JSON tool calls)
			if (match.index > lastIndex) {
				const textBefore = remainingText.slice(lastIndex, match.index);
				if (textBefore.trim()) {
					if (containsToolResult(textBefore)) {
						parts.push(...parseTextForToolResults(textBefore));
					} else if (isJsonToolCall(textBefore)) {
						// Render JSON tool calls as code blocks
						try {
							const formatted = JSON.stringify(JSON.parse(textBefore.trim()), null, 2);
							parts.push({ type: 'code', content: formatted, language: 'json' });
						} catch {
							parts.push({ type: 'text', content: textBefore });
						}
					} else {
						parts.push({ type: 'text', content: textBefore });
					}
				}
			}

			// Add the code block
			const language = match[1] || 'text';
			parts.push({
				type: 'code',
				content: match[2].trim(),
				language,
				showPreview: shouldShowPreview(language)
			});

			lastIndex = match.index + match[0].length;
		}

		// Add remaining text after last code block
		if (lastIndex < remainingText.length) {
			const remaining = remainingText.slice(lastIndex);
			if (remaining.trim()) {
				if (containsToolResult(remaining)) {
					parts.push(...parseTextForToolResults(remaining));
				} else if (isJsonToolCall(remaining)) {
					// Render JSON tool calls as code blocks
					try {
						const formatted = JSON.stringify(JSON.parse(remaining.trim()), null, 2);
						parts.push({ type: 'code', content: formatted, language: 'json' });
					} catch {
						parts.push({ type: 'text', content: remaining });
					}
				} else {
					parts.push({ type: 'text', content: remaining });
				}
			}
		}

		// If no code blocks found and no thinking, check for tool results in entire content
		if (parts.length === thinkingParts.length && remainingText.trim()) {
			if (containsToolResult(remainingText)) {
				parts.push(...parseTextForToolResults(remainingText));
			} else if (isJsonToolCall(remainingText)) {
				// Render JSON tool calls as code blocks
				try {
					const formatted = JSON.stringify(JSON.parse(remainingText.trim()), null, 2);
					parts.push({ type: 'code', content: formatted, language: 'json' });
				} catch {
					parts.push({ type: 'text', content: remainingText });
				}
			} else {
				parts.push({ type: 'text', content: remainingText });
			}
		}

		return { parts, isThinkingInProgress };
	}

	/**
	 * Render markdown to sanitized HTML
	 */
	function renderMarkdown(text: string): string {
		// Configure marked for safe rendering
		const html = marked.parse(text, {
			async: false,
			gfm: true,
			breaks: true
		}) as string;

		// Sanitize the HTML
		return DOMPurify.sanitize(html, {
			USE_PROFILES: { html: true },
			ALLOWED_TAGS: [
				'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
				'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
				'ul', 'ol', 'li',
				'blockquote', 'hr',
				'a', 'code', 'pre',
				'table', 'thead', 'tbody', 'tr', 'th', 'td',
				'img', 'span', 'div', 'sub', 'sup'
			],
			ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel']
		});
	}

	/**
	 * Get the data URL for an image
	 */
	function getImageUrl(image: string): string {
		return base64ToDataUrl(image);
	}

	/**
	 * Open the image modal
	 */
	function openImageModal(image: string): void {
		modalImage = image;
	}

	/**
	 * Close the image modal
	 */
	function closeImageModal(): void {
		modalImage = null;
	}

	/**
	 * Handle keyboard events on modal
	 */
	function handleModalKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			closeImageModal();
		}
	}

	// Clean and parse content into parts
	const cleanedContent = $derived(cleanToolText(content));
	const parsedContent = $derived.by(() => {
		const result = parseContent(cleanedContent);
		// Debug: Log if thinking blocks were found
		const thinkingParts = result.parts.filter(p => p.type === 'thinking');
		return result;
	});
	// Filter out thinking parts if showThinking is false
	const contentParts = $derived(
		showThinking
			? parsedContent.parts
			: parsedContent.parts.filter(p => p.type !== 'thinking')
	);
	const isThinkingInProgress = $derived(showThinking && parsedContent.isThinkingInProgress);
</script>

<div class="message-content">
	<!-- Render images if present -->
	{#if images && images.length > 0}
		<div class="mb-3 flex flex-wrap gap-2">
			{#each images as image, index}
				<button
					type="button"
					class="group relative block overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-all hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800"
					onclick={() => openImageModal(image)}
				>
					<img
						src={getImageUrl(image)}
						alt={`Attached image ${index + 1}`}
						class="max-h-48 max-w-full object-contain"
					/>
					<!-- Hover overlay with expand icon -->
					<div class="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="h-6 w-6 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100"
						>
							<path d="M13.28 7.78l3.22-3.22v2.69a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.69l-3.22 3.22a.75.75 0 001.06 1.06zM2 17.25v-4.5a.75.75 0 011.5 0v2.69l3.22-3.22a.75.75 0 011.06 1.06L4.56 16.5h2.69a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75zM12.22 13.28l3.22 3.22h-2.69a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75v-4.5a.75.75 0 00-1.5 0v2.69l-3.22-3.22a.75.75 0 10-1.06 1.06zM3.5 4.56l3.22 3.22a.75.75 0 001.06-1.06L4.56 3.5h2.69a.75.75 0 000-1.5h-4.5a.75.75 0 00-.75.75v4.5a.75.75 0 001.5 0V4.56z" />
						</svg>
					</div>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Render content parts -->
	{#each contentParts as part, index (index)}
		{#if part.type === 'thinking'}
			<ThinkingBlock
				content={part.content}
				inProgress={isThinkingInProgress && index === 0}
			/>
		{:else if part.type === 'code'}
			<div class="my-3 space-y-3">
				<CodeBlock
					code={part.content}
					language={part.language || 'text'}
					{isStreaming}
				/>
				<!-- Show preview for HTML code blocks -->
				{#if part.showPreview}
					<HtmlPreview
						html={part.content}
						title="HTML Preview"
					/>
				{/if}
			</div>
		{:else if part.type === 'tool-result'}
			<ToolResultDisplay content={part.content} />
		{:else}
			<div class="prose prose-sm prose-invert max-w-none">
				{@html renderMarkdown(part.content)}
			</div>
		{/if}
	{/each}
</div>

<!-- Full-size image modal -->
{#if modalImage}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Full size image"
		onclick={closeImageModal}
		onkeydown={handleModalKeydown}
	>
		<!-- Close button -->
		<button
			type="button"
			onclick={closeImageModal}
			class="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white"
			aria-label="Close preview"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 20 20"
				fill="currentColor"
				class="h-6 w-6"
			>
				<path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
			</svg>
		</button>

		<!-- Full-size image -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<img
			src={getImageUrl(modalImage)}
			alt="Full size view"
			class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		/>
	</div>
{/if}

<style>
	/* Prose styling overrides for chat context */
	.message-content :global(.prose) {
		@apply leading-relaxed;
	}

	.message-content :global(.prose p) {
		@apply my-1;
	}

	.message-content :global(.prose p:first-child) {
		@apply mt-0;
	}

	.message-content :global(.prose p:last-child) {
		@apply mb-0;
	}

	.message-content :global(.prose pre) {
		@apply my-2 rounded-lg;
	}

	.message-content :global(.prose a) {
		@apply hover:underline;
	}

	.message-content :global(.prose ul),
	.message-content :global(.prose ol) {
		@apply my-2 pl-4;
	}

	.message-content :global(.prose li) {
		@apply my-0.5;
	}

	.message-content :global(.prose table) {
		@apply my-2 w-full border-collapse text-sm;
	}

	.message-content :global(.prose th),
	.message-content :global(.prose td) {
		@apply px-3 py-2;
	}

	/* Light mode prose styles */
	.message-content :global(.prose) {
		@apply text-slate-800;
	}

	.message-content :global(.prose code:not(pre code)) {
		@apply rounded bg-slate-200 px-1.5 py-0.5 text-sm text-emerald-700;
	}

	.message-content :global(.prose a) {
		@apply text-blue-600 hover:text-blue-700;
	}

	.message-content :global(.prose blockquote) {
		@apply border-l-4 border-slate-300 pl-4 italic text-slate-600;
	}

	.message-content :global(.prose th),
	.message-content :global(.prose td) {
		@apply border border-slate-300;
	}

	.message-content :global(.prose th) {
		@apply bg-slate-100 font-semibold text-slate-800;
	}

	.message-content :global(.prose td) {
		@apply bg-white text-slate-700;
	}

	.message-content :global(.prose tr:hover td) {
		@apply bg-slate-50;
	}

	.message-content :global(.prose strong) {
		@apply text-slate-900;
	}

	.message-content :global(.prose em) {
		@apply text-slate-700;
	}

	.message-content :global(.prose h1),
	.message-content :global(.prose h2),
	.message-content :global(.prose h3),
	.message-content :global(.prose h4),
	.message-content :global(.prose h5),
	.message-content :global(.prose h6) {
		@apply text-slate-900;
	}

	.message-content :global(.prose hr) {
		@apply border-slate-300;
	}

	/* Dark mode prose styles */
	:global(.dark) .message-content :global(.prose) {
		@apply text-slate-200;
	}

	:global(.dark) .message-content :global(.prose code:not(pre code)) {
		@apply bg-slate-700 text-emerald-400;
	}

	:global(.dark) .message-content :global(.prose a) {
		@apply text-blue-400 hover:text-blue-300;
	}

	:global(.dark) .message-content :global(.prose blockquote) {
		@apply border-slate-600 text-slate-400;
	}

	:global(.dark) .message-content :global(.prose th),
	:global(.dark) .message-content :global(.prose td) {
		@apply border-slate-600;
	}

	:global(.dark) .message-content :global(.prose th) {
		@apply bg-slate-700 text-slate-200;
	}

	:global(.dark) .message-content :global(.prose td) {
		@apply bg-slate-800/50 text-slate-300;
	}

	:global(.dark) .message-content :global(.prose tr:hover td) {
		@apply bg-slate-700/50;
	}

	:global(.dark) .message-content :global(.prose strong) {
		@apply text-slate-100;
	}

	:global(.dark) .message-content :global(.prose em) {
		@apply text-slate-300;
	}

	:global(.dark) .message-content :global(.prose h1),
	:global(.dark) .message-content :global(.prose h2),
	:global(.dark) .message-content :global(.prose h3),
	:global(.dark) .message-content :global(.prose h4),
	:global(.dark) .message-content :global(.prose h5),
	:global(.dark) .message-content :global(.prose h6) {
		@apply text-slate-100;
	}

	:global(.dark) .message-content :global(.prose hr) {
		@apply border-slate-600;
	}
</style>
