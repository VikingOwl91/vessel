<script lang="ts">
	/**
	 * FilePreview.svelte - Preview for attached text/PDF files
	 * Shows filename, size, and expandable content preview
	 * Includes remove button on hover
	 */
	import type { FileAttachment } from '$lib/types/attachment.js';
	import { formatFileSize, getFileIcon } from '$lib/utils/file-processor.js';

	interface Props {
		attachment: FileAttachment;
		onRemove?: (id: string) => void;
		readonly?: boolean;
	}

	const { attachment, onRemove, readonly = false }: Props = $props();

	// Expansion state for content preview
	let isExpanded = $state(false);

	// Truncate preview to first N characters
	const PREVIEW_LENGTH = 200;
	const hasContent = attachment.textContent && attachment.textContent.length > 0;
	const previewText = $derived(
		attachment.textContent
			? attachment.textContent.slice(0, PREVIEW_LENGTH) +
				(attachment.textContent.length > PREVIEW_LENGTH ? '...' : '')
			: ''
	);

	function handleRemove() {
		onRemove?.(attachment.id);
	}

	function toggleExpand() {
		if (hasContent) {
			isExpanded = !isExpanded;
		}
	}
</script>

<div
	class="group relative flex items-start gap-3 rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 transition-colors hover:bg-slate-800"
>
	<!-- File icon -->
	<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-700/50 text-lg">
		{getFileIcon(attachment.type)}
	</div>

	<!-- File info -->
	<div class="min-w-0 flex-1">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="truncate text-sm font-medium text-slate-200" title={attachment.filename}>
					{attachment.filename}
				</p>
				<p class="text-xs text-slate-500">
					{formatFileSize(attachment.size)}
					{#if attachment.type === 'pdf'}
						<span class="text-slate-600">·</span>
						<span class="text-violet-400">PDF</span>
					{/if}
				</p>
			</div>

			<!-- Remove button (only when not readonly) -->
			{#if !readonly && onRemove}
				<button
					type="button"
					onclick={handleRemove}
					class="shrink-0 rounded p-1 text-slate-500 opacity-0 transition-all hover:bg-red-900/30 hover:text-red-400 group-hover:opacity-100"
					aria-label="Remove file"
					title="Remove"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-4 w-4"
					>
						<path
							d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
						/>
					</svg>
				</button>
			{/if}
		</div>

		<!-- Content preview (expandable) -->
		{#if hasContent}
			<button
				type="button"
				onclick={toggleExpand}
				class="mt-2 w-full text-left"
			>
				<div
					class="rounded border border-slate-700/50 bg-slate-900/50 p-2 text-xs text-slate-400 transition-colors hover:border-slate-600"
				>
					{#if isExpanded}
						<pre class="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono">{attachment.textContent}</pre>
					{:else}
						<p class="truncate font-mono">{previewText}</p>
					{/if}
					<p class="mt-1 text-[10px] text-slate-600">
						{isExpanded ? 'Click to collapse' : 'Click to expand'}
					</p>
				</div>
			</button>
		{/if}
	</div>
</div>
