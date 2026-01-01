<script lang="ts">
	/**
	 * ChatInput - Message input area with auto-growing textarea
	 * Handles send/stop actions, keyboard shortcuts, and file uploads
	 * Drag overlay appears when files are dragged over the input area
	 */

	import { modelsState } from '$lib/stores';
	import type { FileAttachment } from '$lib/types/attachment.js';
	import { formatAttachmentsForMessage, processFile } from '$lib/utils/file-processor.js';
	import { isImageMimeType } from '$lib/types/attachment.js';
	import { estimateMessageTokens, formatTokenCount } from '$lib/memory/tokenizer';
	import FileUpload from './FileUpload.svelte';

	interface Props {
		onSend?: (content: string, images?: string[]) => void;
		onStop?: () => void;
		isStreaming?: boolean;
		disabled?: boolean;
		placeholder?: string;
	}

	const {
		onSend,
		onStop,
		isStreaming = false,
		disabled = false,
		placeholder = 'Type a message...'
	}: Props = $props();

	// Input state
	let inputValue = $state('');
	let textareaElement: HTMLTextAreaElement | null = $state(null);

	// Image state (for vision models)
	let pendingImages = $state<string[]>([]);

	// File attachment state (text/PDF for all models)
	let pendingAttachments = $state<FileAttachment[]>([]);

	// Drag overlay state
	let isDragOver = $state(false);
	let dragCounter = 0; // Track enter/leave for nested elements

	// Derived state
	const hasContent = $derived(
		inputValue.trim().length > 0 || pendingImages.length > 0 || pendingAttachments.length > 0
	);
	const canSend = $derived(hasContent && !disabled && !isStreaming);
	const showStopButton = $derived(isStreaming);

	// Vision model detection
	const isVisionModel = $derived(modelsState.selectedSupportsVision);

	// Token estimation for current input
	const tokenEstimate = $derived(
		estimateMessageTokens(inputValue, pendingImages.length > 0 ? pendingImages : undefined)
	);
	const showTokenCount = $derived(inputValue.length > 0 || pendingImages.length > 0);

	/**
	 * Auto-resize textarea based on content
	 */
	function autoResize(): void {
		if (!textareaElement) return;

		// Reset height to auto to get the correct scrollHeight
		textareaElement.style.height = 'auto';

		// Calculate new height (max 200px)
		const newHeight = Math.min(textareaElement.scrollHeight, 200);
		textareaElement.style.height = `${newHeight}px`;
	}

	/**
	 * Handle input changes
	 */
	function handleInput(): void {
		autoResize();
	}

	/**
	 * Handle keyboard events
	 */
	function handleKeydown(event: KeyboardEvent): void {
		// Enter to send (without Shift)
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	/**
	 * Send the message
	 */
	function handleSend(): void {
		if (!canSend) return;

		let content = inputValue.trim();
		const images = pendingImages.length > 0 ? [...pendingImages] : undefined;

		// Prepend file attachments content to the message
		if (pendingAttachments.length > 0) {
			const attachmentContent = formatAttachmentsForMessage(pendingAttachments);
			if (attachmentContent) {
				content = attachmentContent + (content ? '\n\n' + content : '');
			}
		}

		// Clear input, images, and attachments
		inputValue = '';
		pendingImages = [];
		pendingAttachments = [];

		// Reset textarea height
		if (textareaElement) {
			textareaElement.style.height = 'auto';
		}

		onSend?.(content, images);

		// Keep focus on input after sending
		requestAnimationFrame(() => focusInput());
	}

	/**
	 * Stop streaming
	 */
	function handleStop(): void {
		onStop?.();
	}

	/**
	 * Handle image changes from FileUpload
	 */
	function handleImagesChange(images: string[]): void {
		pendingImages = images;
	}

	/**
	 * Handle attachment changes from FileUpload
	 */
	function handleAttachmentsChange(attachments: FileAttachment[]): void {
		pendingAttachments = attachments;
	}

	/**
	 * Focus the textarea
	 */
	function focusInput(): void {
		if (textareaElement && !disabled) {
			textareaElement.focus();
		}
	}

	// Focus textarea on mount
	$effect(() => {
		focusInput();
	});

	// =========================================================================
	// Drag & Drop - Document-level listeners for reliable detection
	// =========================================================================

	// Set up document-level drag listeners for reliable detection
	$effect(() => {
		if (disabled) return;

		function onDragEnter(event: DragEvent): void {
			if (!event.dataTransfer?.types.includes('Files')) return;
			event.preventDefault();
			dragCounter++;
			isDragOver = true;
		}

		function onDragLeave(event: DragEvent): void {
			event.preventDefault();
			dragCounter--;
			if (dragCounter <= 0) {
				dragCounter = 0;
				isDragOver = false;
			}
		}

		function onDragOver(event: DragEvent): void {
			if (!event.dataTransfer?.types.includes('Files')) return;
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
		}

		function onDrop(event: DragEvent): void {
			event.preventDefault();
			isDragOver = false;
			dragCounter = 0;

			if (!event.dataTransfer?.files.length) return;
			const files = Array.from(event.dataTransfer.files);
			processDroppedFiles(files);
		}

		document.addEventListener('dragenter', onDragEnter);
		document.addEventListener('dragleave', onDragLeave);
		document.addEventListener('dragover', onDragOver);
		document.addEventListener('drop', onDrop);

		return () => {
			document.removeEventListener('dragenter', onDragEnter);
			document.removeEventListener('dragleave', onDragLeave);
			document.removeEventListener('dragover', onDragOver);
			document.removeEventListener('drop', onDrop);
		};
	});

	/**
	 * Process dropped files - images go to pendingImages, others to attachments
	 */
	async function processDroppedFiles(files: File[]): Promise<void> {
		const imageFiles: File[] = [];
		const otherFiles: File[] = [];

		for (const file of files) {
			if (isImageMimeType(file.type)) {
				imageFiles.push(file);
			} else {
				otherFiles.push(file);
			}
		}

		// Process images if vision is supported
		if (imageFiles.length > 0 && isVisionModel) {
			const { processImageForOllama, isValidImageType } = await import('$lib/ollama/image-processor');
			const validImages = imageFiles.filter(isValidImageType);
			const maxImages = 4;
			const remainingSlots = maxImages - pendingImages.length;
			const toProcess = validImages.slice(0, remainingSlots);

			for (const file of toProcess) {
				try {
					const processed = await processImageForOllama(file);
					pendingImages = [...pendingImages, processed.base64];
				} catch (err) {
					console.error('Failed to process image:', err);
				}
			}
		}

		// Process other files
		for (const file of otherFiles) {
			const result = await processFile(file);
			if (result.success) {
				pendingAttachments = [...pendingAttachments, result.attachment];
			}
		}
	}
</script>

<!-- Full-screen drag overlay - shown when dragging files anywhere on the page -->
{#if isDragOver}
	<div class="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
		<div class="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-violet-500 bg-slate-800/90 p-8 text-violet-300">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-12 w-12">
				<path fill-rule="evenodd" d="M10.5 3.75a6 6 0 0 0-5.98 6.496A5.25 5.25 0 0 0 6.75 20.25H18a4.5 4.5 0 0 0 2.206-8.423 3.75 3.75 0 0 0-4.133-4.303A6.001 6.001 0 0 0 10.5 3.75Zm2.03 5.47a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 1 0 1.06 1.06l1.72-1.72v4.19a.75.75 0 0 0 1.5 0v-4.19l1.72 1.72a.75.75 0 1 0 1.06-1.06l-3-3Z" clip-rule="evenodd" />
			</svg>
			<span class="text-lg font-medium">
				{#if isVisionModel}
					Drop images or files
				{:else}
					Drop files here
				{/if}
			</span>
			<span class="text-sm text-slate-400">
				{#if isVisionModel}
					Images, text files, and PDFs supported
				{:else}
					Text files and PDFs supported
				{/if}
			</span>
		</div>
	</div>
{/if}

<div class="relative space-y-2">

	<!-- File upload area (images for vision models, text/PDFs for all) -->
	<FileUpload
		images={pendingImages}
		onImagesChange={handleImagesChange}
		attachments={pendingAttachments}
		onAttachmentsChange={handleAttachmentsChange}
		supportsVision={isVisionModel}
		{disabled}
		hideDropZone={true}
	/>

	<div
		class="flex items-end gap-3 rounded-2xl border border-slate-700/50 bg-slate-800/80 p-3 backdrop-blur transition-all focus-within:border-slate-600 focus-within:bg-slate-800"
	>
		<!-- Attachment indicators -->
		{#if pendingImages.length > 0 || pendingAttachments.length > 0}
			<div class="flex h-9 items-center gap-1.5">
				{#if pendingImages.length > 0}
					<span class="flex items-center gap-1 rounded-lg bg-violet-500/20 px-2 py-1 text-xs font-medium text-violet-300" title="Images attached">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="h-3.5 w-3.5"
						>
							<path
								fill-rule="evenodd"
								d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"
								clip-rule="evenodd"
							/>
						</svg>
						{pendingImages.length}
					</span>
				{/if}
				{#if pendingAttachments.length > 0}
					<span class="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 text-xs font-medium text-emerald-300" title="Files attached">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="h-3.5 w-3.5"
						>
							<path
								fill-rule="evenodd"
								d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z"
								clip-rule="evenodd"
							/>
						</svg>
						{pendingAttachments.length}
					</span>
				{/if}
			</div>
		{/if}

		<!-- Textarea - allow typing during streaming, only block sending -->
		<textarea
			bind:this={textareaElement}
			bind:value={inputValue}
			oninput={handleInput}
			onkeydown={handleKeydown}
			{placeholder}
			{disabled}
			rows="1"
			class="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-1 py-1.5 text-slate-100 placeholder-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
			aria-label="Message input"
			data-chat-input
		></textarea>

		<!-- Action buttons -->
		<div class="flex items-center">
			{#if showStopButton}
				<!-- Stop button -->
				<button
					type="button"
					onclick={handleStop}
					class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/30 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500/50"
					aria-label="Stop generating"
					title="Stop generating"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-5 w-5"
					>
						<rect x="5" y="5" width="10" height="10" rx="1" />
					</svg>
				</button>
			{:else}
				<!-- Send button -->
				<button
					type="button"
					onclick={handleSend}
					disabled={!canSend}
					class="flex h-9 w-9 items-center justify-center rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/50 {canSend
						? 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 hover:text-violet-300'
						: 'text-slate-600 cursor-not-allowed'}"
					aria-label="Send message"
					title="Send message"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-5 w-5"
					>
						<path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- Subtle helper text -->
	<p class="text-center text-[11px] text-slate-600">
		<kbd class="rounded bg-slate-800 px-1 py-0.5 font-mono">Enter</kbd> send
		<span class="mx-1.5 text-slate-700">·</span>
		<kbd class="rounded bg-slate-800 px-1 py-0.5 font-mono">Shift+Enter</kbd> new line
		<span class="mx-1.5 text-slate-700">·</span>
		{#if isVisionModel}
			<span class="text-violet-500/70">images</span>
			<span class="mx-1 text-slate-700">+</span>
		{/if}
		<span class="text-slate-500">files supported</span>
		{#if showTokenCount}
			<span class="mx-1.5 text-slate-700">·</span>
			<span class="text-slate-500" title="{tokenEstimate.textTokens} text + {tokenEstimate.imageTokens} image tokens">
				~{formatTokenCount(tokenEstimate.totalTokens)} tokens
			</span>
		{/if}
	</p>
</div>
