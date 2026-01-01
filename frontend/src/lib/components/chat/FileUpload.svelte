<script lang="ts">
	/**
	 * FileUpload.svelte - Unified file upload for chat input
	 * Handles both images (for vision models) and text/PDF files (for all models)
	 * - Images: shown only for vision-capable models
	 * - Text/PDF: available for all models (content prepended to message)
	 */
	import type { FileAttachment } from '$lib/types/attachment.js';
	import { processFile, formatFileSize } from '$lib/utils/file-processor.js';
	import { isImageMimeType } from '$lib/types/attachment.js';
	import ImageUpload from './ImageUpload.svelte';
	import FilePreview from './FilePreview.svelte';

	interface Props {
		/** Images for vision models (base64 without prefix) */
		images: string[];
		onImagesChange: (images: string[]) => void;
		/** Text/PDF file attachments */
		attachments: FileAttachment[];
		onAttachmentsChange: (attachments: FileAttachment[]) => void;
		/** Whether the model supports vision */
		supportsVision?: boolean;
		/** Whether upload is disabled */
		disabled?: boolean;
		/** Hide the drop zone (when drag overlay is handled by parent) */
		hideDropZone?: boolean;
	}

	const {
		images,
		onImagesChange,
		attachments,
		onAttachmentsChange,
		supportsVision = false,
		disabled = false,
		hideDropZone = false
	}: Props = $props();

	// Processing state
	let isProcessing = $state(false);
	let errorMessage = $state<string | null>(null);
	let fileInputRef: HTMLInputElement | null = $state(null);

	// Derived states
	const hasAttachments = $derived(attachments.length > 0);
	const hasImages = $derived(images.length > 0);
	const hasContent = $derived(hasAttachments || hasImages);

	// Accept string for file input (text files and PDFs, no images - those go through ImageUpload)
	const fileAccept = '.txt,.md,.json,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.rb,.php,.sh,.sql,.css,.html,.xml,.yaml,.yml,.toml,application/pdf,text/*';

	/**
	 * Handle file selection from input
	 */
	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		await processFiles(Array.from(input.files));
		input.value = ''; // Reset to allow same file selection
	}

	/**
	 * Process multiple files
	 */
	async function processFiles(files: File[]) {
		isProcessing = true;
		errorMessage = null;

		const newAttachments: FileAttachment[] = [];
		const errors: string[] = [];

		for (const file of files) {
			// Skip images - they're handled by ImageUpload
			if (isImageMimeType(file.type)) {
				continue;
			}

			const result = await processFile(file);
			if (result.success) {
				newAttachments.push(result.attachment);
			} else {
				errors.push(`${file.name}: ${result.error}`);
			}
		}

		if (newAttachments.length > 0) {
			onAttachmentsChange([...attachments, ...newAttachments]);
		}

		if (errors.length > 0) {
			errorMessage = errors.join('; ');
			setTimeout(() => {
				errorMessage = null;
			}, 5000);
		}

		isProcessing = false;
	}

	/**
	 * Remove an attachment by ID
	 */
	function removeAttachment(id: string) {
		onAttachmentsChange(attachments.filter((a) => a.id !== id));
	}

	/**
	 * Open file picker
	 */
	function openFilePicker() {
		if (!disabled && fileInputRef) {
			fileInputRef.click();
		}
	}

	/**
	 * Handle paste events for file attachments and images
	 * Images are forwarded to ImageUpload when vision is supported,
	 * otherwise shows a helpful message
	 */
	function handlePaste(event: ClipboardEvent) {
		if (disabled) return;

		const items = event.clipboardData?.items;
		if (!items) return;

		const files: File[] = [];
		const imageFiles: File[] = [];

		for (const item of items) {
			const file = item.getAsFile();
			if (!file) continue;

			if (item.type.startsWith('image/')) {
				imageFiles.push(file);
			} else {
				files.push(file);
			}
		}

		// Handle non-image files
		if (files.length > 0) {
			processFiles(files);
		}

		// Handle image files
		if (imageFiles.length > 0) {
			event.preventDefault();

			if (supportsVision) {
				// Forward to ImageUpload by triggering file processing there
				// ImageUpload has its own paste handler, but we handle it here too
				// to ensure consistent behavior
				processImageFiles(imageFiles);
			} else {
				// Show message that images require vision model
				errorMessage = 'Images can only be used with vision-capable models (e.g., llava, bakllava)';
				setTimeout(() => {
					errorMessage = null;
				}, 5000);
			}
		}
	}

	/**
	 * Process image files and add to images array
	 */
	async function processImageFiles(files: File[]) {
		// Import the processor dynamically to keep bundle small when not needed
		const { processImageForOllama, isValidImageType, ImageProcessingError } = await import(
			'$lib/ollama/image-processor'
		);

		const validFiles = files.filter(isValidImageType);
		if (validFiles.length === 0) {
			errorMessage = 'No valid image files. Supported: JPEG, PNG, GIF, WebP';
			setTimeout(() => {
				errorMessage = null;
			}, 3000);
			return;
		}

		// Limit to 4 images max
		const maxImages = 4;
		const remainingSlots = maxImages - images.length;
		const filesToProcess = validFiles.slice(0, remainingSlots);

		if (filesToProcess.length === 0) {
			errorMessage = `Maximum ${maxImages} images allowed`;
			setTimeout(() => {
				errorMessage = null;
			}, 3000);
			return;
		}

		isProcessing = true;
		errorMessage = null;

		try {
			const newImages: string[] = [];

			for (const file of filesToProcess) {
				try {
					const processed = await processImageForOllama(file);
					newImages.push(processed.base64);
				} catch (err) {
					if (err instanceof ImageProcessingError) {
						console.error(`Failed to process ${file.name}:`, err.message);
						errorMessage = err.message;
					} else {
						console.error(`Failed to process ${file.name}:`, err);
						errorMessage = `Failed to process ${file.name}`;
					}
				}
			}

			if (newImages.length > 0) {
				onImagesChange([...images, ...newImages]);
			}
		} finally {
			isProcessing = false;
		}
	}

	// Set up paste listener
	$effect(() => {
		if (!disabled) {
			document.addEventListener('paste', handlePaste);
			return () => {
				document.removeEventListener('paste', handlePaste);
			};
		}
	});
</script>

<div class="space-y-3">
	<!-- Image upload section (only for vision models) -->
	{#if supportsVision}
		<ImageUpload {images} {onImagesChange} {disabled} {hideDropZone} />
	{/if}

	<!-- File attachments preview -->
	{#if hasAttachments}
		<div class="space-y-2">
			{#each attachments as attachment (attachment.id)}
				<FilePreview {attachment} onRemove={removeAttachment} />
			{/each}
		</div>
	{/if}

	<!-- Add files button -->
	<div class="flex items-center gap-2">
		<!-- Hidden file input -->
		<input
			bind:this={fileInputRef}
			type="file"
			accept={fileAccept}
			multiple
			class="hidden"
			onchange={handleFileSelect}
			{disabled}
		/>

		<!-- Attach files button -->
		<button
			type="button"
			onclick={openFilePicker}
			disabled={disabled || isProcessing}
			class="flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if isProcessing}
				<svg
					class="h-4 w-4 animate-spin"
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
				<span>Processing...</span>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-4 w-4"
				>
					<path
						fill-rule="evenodd"
						d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z"
						clip-rule="evenodd"
					/>
				</svg>
				<span>Attach files</span>
			{/if}
		</button>

		<!-- File type hint -->
		<span class="text-[10px] text-slate-600">
			{#if supportsVision}
				Images, text files, PDFs
			{:else}
				Text files, PDFs (content will be included in message)
			{/if}
		</span>
	</div>

	<!-- Error message -->
	{#if errorMessage}
		<div class="rounded-lg bg-red-900/20 px-3 py-2 text-xs text-red-400">
			{errorMessage}
		</div>
	{/if}
</div>
