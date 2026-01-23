<script lang="ts">
	/**
	 * ImportDialog - Modal for importing conversations from JSON files
	 * Supports drag-and-drop and file picker, validates before import
	 */
	import { goto } from '$app/navigation';
	import {
		parseImportFile,
		importConversation,
		formatFileSize,
		type ValidationResult
	} from '$lib/utils/import';
	import { toastState, conversationsState } from '$lib/stores';
	import { getAllConversations } from '$lib/storage';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen, onClose }: Props = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let isDragOver = $state(false);
	let selectedFile = $state<File | null>(null);
	let validationResult = $state<ValidationResult | null>(null);
	let isValidating = $state(false);
	let isImporting = $state(false);

	/**
	 * Handle file selection from input
	 */
	async function handleFileSelect(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) {
			await processFile(file);
		}
	}

	/**
	 * Handle drag over
	 */
	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragOver = true;
	}

	/**
	 * Handle drag leave
	 */
	function handleDragLeave(): void {
		isDragOver = false;
	}

	/**
	 * Handle file drop
	 */
	async function handleDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		isDragOver = false;

		const file = event.dataTransfer?.files[0];
		if (file) {
			await processFile(file);
		}
	}

	/**
	 * Process selected file
	 */
	async function processFile(file: File): Promise<void> {
		// Validate file type
		if (!file.name.endsWith('.json')) {
			toastState.error('Please select a JSON file');
			return;
		}

		selectedFile = file;
		isValidating = true;
		validationResult = null;

		try {
			validationResult = await parseImportFile(file);
		} catch (error) {
			validationResult = {
				valid: false,
				errors: [error instanceof Error ? error.message : 'Failed to parse file'],
				warnings: []
			};
		} finally {
			isValidating = false;
		}
	}

	/**
	 * Handle import action
	 */
	async function handleImport(): Promise<void> {
		if (!validationResult?.valid || !validationResult.data) return;

		isImporting = true;

		try {
			const result = await importConversation(validationResult.data);

			if (result.success && result.conversationId) {
				toastState.success('Conversation imported successfully');
				// Reload conversations list
				const convResult = await getAllConversations();
				if (convResult.success && convResult.data) {
					conversationsState.load(convResult.data);
				}
				onClose();
				goto(`/chat/${result.conversationId}`);
			} else {
				toastState.error(result.error || 'Failed to import conversation');
			}
		} catch (error) {
			toastState.error(
				`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		} finally {
			isImporting = false;
		}
	}

	/**
	 * Reset and close
	 */
	function handleClose(): void {
		selectedFile = null;
		validationResult = null;
		isDragOver = false;
		onClose();
	}

	/**
	 * Handle backdrop click to close
	 */
	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			handleClose();
		}
	}

	/**
	 * Handle escape key to close
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			handleClose();
		}
	}

	/**
	 * Open file picker
	 */
	function openFilePicker(): void {
		fileInput?.click();
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="import-dialog-title"
		tabindex="-1"
	>
		<!-- Dialog -->
		<div class="mx-4 w-full max-w-lg rounded-xl border border-theme bg-theme-primary shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-theme px-6 py-4">
				<h2 id="import-dialog-title" class="text-lg font-semibold text-theme-primary">
					Import Conversation
				</h2>
				<button
					type="button"
					onclick={handleClose}
					class="rounded-lg p-1.5 text-theme-muted transition-colors hover:bg-theme-secondary hover:text-theme-secondary"
					aria-label="Close dialog"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="space-y-5 px-6 py-5">
				<!-- Hidden file input -->
				<input
					bind:this={fileInput}
					type="file"
					accept=".json"
					class="hidden"
					onchange={handleFileSelect}
				/>

				<!-- Drop zone -->
				<button
					type="button"
					onclick={openFilePicker}
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
					ondrop={handleDrop}
					class="w-full rounded-lg border-2 border-dashed p-8 text-center transition-colors {isDragOver
						? 'border-emerald-500 bg-emerald-500/10'
						: 'border-theme-subtle hover:border-theme-subtle'}"
				>
					<svg
						class="mx-auto h-12 w-12 text-theme-muted"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
						/>
					</svg>
					<p class="mt-2 text-sm text-theme-muted">
						{#if isDragOver}
							Drop file here
						{:else}
							Drag and drop a JSON file, or <span class="text-emerald-400">click to browse</span>
						{/if}
					</p>
					<p class="mt-1 text-xs text-theme-muted">Only JSON files exported from this app</p>
				</button>

				{#if isValidating}
					<!-- Validating state -->
					<div class="flex items-center justify-center py-4">
						<svg class="h-5 w-5 animate-spin text-theme-muted" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
								fill="none"
							/>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						<span class="ml-2 text-sm text-theme-muted">Validating file...</span>
					</div>
				{:else if selectedFile && validationResult}
					<!-- Validation results -->
					<div class="space-y-3">
						<!-- File info -->
						<div class="flex items-center gap-3 rounded-lg bg-theme-secondary p-3">
							<svg class="h-8 w-8 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
								/>
							</svg>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-theme-secondary">{selectedFile.name}</p>
								<p class="text-xs text-theme-muted">{formatFileSize(selectedFile.size)}</p>
							</div>
							<button
								type="button"
								onclick={() => {
									selectedFile = null;
									validationResult = null;
								}}
								class="rounded p-1 text-theme-muted hover:bg-theme-tertiary hover:text-theme-secondary"
								aria-label="Remove file"
							>
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>

						{#if validationResult.valid && validationResult.data}
							<!-- Success preview -->
							<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
								<div class="flex items-center gap-2 text-emerald-400">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
									</svg>
									<span class="font-medium">Valid conversation file</span>
								</div>
								<div class="mt-3 space-y-1 text-sm text-theme-secondary">
									<p><span class="text-theme-muted">Title:</span> {validationResult.data.title}</p>
									<p><span class="text-theme-muted">Model:</span> {validationResult.data.model}</p>
									<p><span class="text-theme-muted">Messages:</span> {validationResult.data.messages.length}</p>
								</div>
							</div>
						{/if}

						<!-- Errors -->
						{#if validationResult.errors.length > 0}
							<div class="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
								<div class="flex items-center gap-2 text-red-400">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
									</svg>
									<span class="font-medium">Validation errors</span>
								</div>
								<ul class="mt-2 list-inside list-disc space-y-1 text-sm text-red-300">
									{#each validationResult.errors as error}
										<li>{error}</li>
									{/each}
								</ul>
							</div>
						{/if}

						<!-- Warnings -->
						{#if validationResult.warnings.length > 0}
							<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
								<div class="flex items-center gap-2 text-amber-400">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
									</svg>
									<span class="font-medium">Warnings</span>
								</div>
								<ul class="mt-2 list-inside list-disc space-y-1 text-sm text-amber-300">
									{#each validationResult.warnings as warning}
										<li>{warning}</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex justify-end gap-2 border-t border-theme px-6 py-4">
				<button
					type="button"
					onclick={handleClose}
					class="rounded-lg px-4 py-2.5 text-sm font-medium text-theme-muted transition-colors hover:bg-theme-secondary hover:text-theme-secondary"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleImport}
					disabled={!validationResult?.valid || isImporting}
					class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isImporting}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
								fill="none"
							/>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						Importing...
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
							/>
						</svg>
						Import
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
