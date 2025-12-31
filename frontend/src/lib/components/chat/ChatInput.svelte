<script lang="ts">
	/**
	 * ChatInput - Message input area with auto-growing textarea
	 * Handles send/stop actions, keyboard shortcuts, and image uploads
	 */

	import { modelsState } from '$lib/stores';
	import ImageUpload from './ImageUpload.svelte';

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

	// Image state
	let pendingImages = $state<string[]>([]);

	// Derived state
	const hasContent = $derived(inputValue.trim().length > 0 || pendingImages.length > 0);
	const canSend = $derived(hasContent && !disabled && !isStreaming);
	const showStopButton = $derived(isStreaming);

	// Vision model detection
	const isVisionModel = $derived(modelsState.selectedSupportsVision);

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

		const content = inputValue.trim();
		const images = pendingImages.length > 0 ? [...pendingImages] : undefined;

		// Clear input and images
		inputValue = '';
		pendingImages = [];

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
	 * Handle image changes from ImageUpload
	 */
	function handleImagesChange(images: string[]): void {
		pendingImages = images;
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
</script>

<div class="relative space-y-2">
	<!-- Image upload area (only shown for vision models) -->
	{#if isVisionModel}
		<ImageUpload
			images={pendingImages}
			onImagesChange={handleImagesChange}
			{disabled}
		/>
	{/if}

	<div
		class="flex items-end gap-3 rounded-2xl border border-slate-700/50 bg-slate-800/80 p-3 backdrop-blur transition-all focus-within:border-slate-600 focus-within:bg-slate-800"
	>
		<!-- Image indicator badge (for vision models) -->
		{#if isVisionModel && pendingImages.length > 0}
			<div class="flex h-9 items-center">
				<span class="flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-2.5 py-1 text-xs font-medium text-violet-300">
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
		{#if isVisionModel}
			<span class="mx-1.5 text-slate-700">·</span>
			<span class="text-violet-500/70">images supported</span>
		{/if}
	</p>
</div>
