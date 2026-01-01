<script lang="ts">
	/**
	 * ImageUpload - Drag and drop image upload for vision models
	 * Supports multiple images, shows thumbnails, and handles removal
	 * Note: Clipboard paste is handled by FileUpload for consistent behavior
	 */

	import { processImageForOllama, isValidImageType, ImageProcessingError } from '$lib/ollama/image-processor';
	import ImagePreview from './ImagePreview.svelte';

	interface Props {
		/** Array of base64 encoded images (without data: prefix) */
		images: string[];
		/** Callback when images change */
		onImagesChange: (images: string[]) => void;
		/** Whether upload is disabled */
		disabled?: boolean;
		/** Maximum number of images allowed */
		maxImages?: number;
		/** Hide the drop zone (when drag is handled by parent) */
		hideDropZone?: boolean;
	}

	const {
		images,
		onImagesChange,
		disabled = false,
		maxImages = 4,
		hideDropZone = false
	}: Props = $props();

	/** Drag over state for visual feedback */
	let isDragOver = $state(false);

	/** Processing state */
	let isProcessing = $state(false);

	/** Error message */
	let errorMessage = $state<string | null>(null);

	/** File input reference */
	let fileInputRef: HTMLInputElement | null = $state(null);

	/** Derived: Can add more images */
	const canAddMore = $derived(images.length < maxImages && !disabled);

	/**
	 * Process and add files to the images array
	 */
	async function handleFiles(files: FileList | File[]): Promise<void> {
		if (!canAddMore) return;

		const fileArray = Array.from(files);
		const validFiles = fileArray.filter(isValidImageType);

		if (validFiles.length === 0) {
			errorMessage = 'No valid image files. Supported: JPEG, PNG, GIF, WebP';
			setTimeout(() => { errorMessage = null; }, 3000);
			return;
		}

		// Limit to remaining slots
		const remainingSlots = maxImages - images.length;
		const filesToProcess = validFiles.slice(0, remainingSlots);

		if (filesToProcess.length < validFiles.length) {
			errorMessage = `Only ${remainingSlots} image${remainingSlots === 1 ? '' : 's'} can be added. Maximum: ${maxImages}`;
			setTimeout(() => { errorMessage = null; }, 3000);
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

	/**
	 * Handle file input change
	 */
	function handleInputChange(event: Event): void {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			handleFiles(input.files);
			// Reset input to allow selecting the same file again
			input.value = '';
		}
	}

	/**
	 * Handle drag over
	 */
	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		if (!disabled) {
			isDragOver = true;
		}
	}

	/**
	 * Handle drag leave
	 */
	function handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		isDragOver = false;
	}

	/**
	 * Handle drop
	 */
	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		isDragOver = false;

		if (disabled || !event.dataTransfer?.files) return;

		handleFiles(event.dataTransfer.files);
	}

	/**
	 * Handle click to open file picker
	 */
	function handleClick(): void {
		if (canAddMore && fileInputRef) {
			fileInputRef.click();
		}
	}

	/**
	 * Remove an image at the given index
	 */
	function removeImage(index: number): void {
		const newImages = images.filter((_, i) => i !== index);
		onImagesChange(newImages);
	}

	/**
	 * Handle keyboard events
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleClick();
		}
	}

	// Note: Paste handling is done in FileUpload.svelte to ensure
	// consistent behavior whether or not this component is rendered
</script>

<!-- Only show image previews when hideDropZone is true (parent handles drag) -->
{#if hideDropZone}
	{#if images.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each images as image, index (index)}
				<ImagePreview
					src={image}
					onRemove={() => removeImage(index)}
					alt={`Uploaded image ${index + 1}`}
				/>
			{/each}
		</div>
	{/if}
{:else}
<div class="space-y-3">
	<!-- Image previews -->
	{#if images.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each images as image, index (index)}
				<ImagePreview
					src={image}
					onRemove={() => removeImage(index)}
					alt={`Uploaded image ${index + 1}`}
				/>
			{/each}
		</div>
	{/if}

	<!-- Drop zone / Upload button -->
	{#if canAddMore}
		<div
			role="button"
			tabindex="0"
			class="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors
				{isDragOver
					? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
					: 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'}
				{disabled ? 'cursor-not-allowed opacity-50' : ''}
				{isProcessing ? 'pointer-events-none' : ''}"
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			onclick={handleClick}
			onkeydown={handleKeydown}
			aria-label="Upload images"
		>
			<!-- Hidden file input -->
			<input
				bind:this={fileInputRef}
				type="file"
				accept="image/jpeg,image/png,image/gif,image/webp"
				multiple
				class="hidden"
				onchange={handleInputChange}
				{disabled}
			/>

			{#if isProcessing}
				<!-- Processing indicator -->
				<div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
					<svg
						class="h-5 w-5 animate-spin"
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
					<span class="text-sm">Processing...</span>
				</div>
			{:else}
				<!-- Upload icon -->
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					class="h-8 w-8 text-gray-400 dark:text-gray-500"
				>
					<path
						fill-rule="evenodd"
						d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z"
						clip-rule="evenodd"
					/>
				</svg>

				<!-- Text -->
				<p class="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
					{#if isDragOver}
						Drop images here
					{:else}
						Drag & drop or click to add images
					{/if}
				</p>

				<!-- Count indicator -->
				{#if images.length > 0}
					<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
						{images.length}/{maxImages} images
					</p>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Error message -->
	{#if errorMessage}
		<div class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
			{errorMessage}
		</div>
	{/if}
</div>
{/if}
