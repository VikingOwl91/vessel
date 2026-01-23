<script lang="ts">
	/**
	 * PullModelDialog - Dialog for pulling/downloading new models
	 * Shows input field and links to Ollama model library
	 */

	import { modelOperationsState } from '$lib/stores/model-operations.svelte';

	/**
	 * Handle form submission
	 */
	function handleSubmit(event: Event): void {
		event.preventDefault();
		modelOperationsState.pullModel(modelOperationsState.pullModelInput);
	}

	/**
	 * Handle backdrop click to close
	 */
	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			modelOperationsState.closePullDialog();
		}
	}

	/**
	 * Handle escape key to close
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			modelOperationsState.closePullDialog();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if modelOperationsState.isPullDialogOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="pull-dialog-title"
		tabindex="-1"
	>
		<!-- Dialog -->
		<div class="w-full max-w-md rounded-xl bg-theme-secondary p-6 shadow-xl">
			<h2 id="pull-dialog-title" class="mb-4 text-lg font-semibold text-theme-primary">
				Pull Model
			</h2>

			<form onsubmit={handleSubmit}>
				<div class="mb-4">
					<label for="model-name" class="mb-2 block text-sm text-theme-secondary">
						Model Name
					</label>
					<input
						id="model-name"
						type="text"
						bind:value={modelOperationsState.pullModelInput}
						placeholder="e.g., llama3.2, mistral:7b, codellama:13b"
						class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
						autocomplete="off"
						autocorrect="off"
						autocapitalize="off"
						spellcheck="false"
					/>
					<p class="mt-1 text-xs text-theme-muted">
						Enter the model name with optional tag (e.g., llama3.2:latest)
					</p>
				</div>

				<div class="mb-6">
					<a
						href="https://ollama.com/library"
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300 hover:underline"
					>
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
						</svg>
						Browse Ollama Model Library
					</a>
				</div>

				<div class="flex justify-end gap-3">
					<button
						type="button"
						onclick={() => modelOperationsState.closePullDialog()}
						class="rounded-lg px-4 py-2 text-sm text-theme-secondary hover:bg-theme-tertiary"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!modelOperationsState.pullModelInput.trim()}
						class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Pull Model
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
