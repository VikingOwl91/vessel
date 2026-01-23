<script lang="ts">
	/**
	 * ModelEditorDialog - Dialog for creating/editing custom Ollama models
	 * Supports two modes: create (new model) and edit (update system prompt)
	 */

	import { modelsState, promptsState } from '$lib/stores';
	import { modelCreationState, type ModelEditorMode } from '$lib/stores/model-creation.svelte.js';
	import { modelInfoService } from '$lib/services/model-info-service.js';

	interface Props {
		/** Whether the dialog is open */
		isOpen: boolean;
		/** Mode: create or edit */
		mode: ModelEditorMode;
		/** For edit mode: the model being edited */
		editingModel?: string;
		/** For edit mode: the current system prompt */
		currentSystemPrompt?: string;
		/** For edit mode: the base model (parent) */
		baseModel?: string;
		/** Callback when dialog is closed */
		onClose: () => void;
	}

	let { isOpen, mode, editingModel, currentSystemPrompt, baseModel, onClose }: Props = $props();

	// Form state
	let modelName = $state('');
	let selectedBaseModel = $state('');
	let systemPrompt = $state('');
	let usePromptLibrary = $state(false);
	let selectedPromptId = $state<string | null>(null);

	// Initialize form when opening
	$effect(() => {
		if (isOpen) {
			if (mode === 'edit' && editingModel) {
				modelName = editingModel;
				selectedBaseModel = baseModel || '';
				systemPrompt = currentSystemPrompt || '';
			} else {
				modelName = '';
				selectedBaseModel = modelsState.chatModels[0]?.name || '';
				systemPrompt = '';
			}
			usePromptLibrary = false;
			selectedPromptId = null;
			modelCreationState.reset();
		}
	});

	// Get system prompt content (either from textarea or prompt library)
	const effectiveSystemPrompt = $derived(
		usePromptLibrary && selectedPromptId
			? promptsState.get(selectedPromptId)?.content || ''
			: systemPrompt
	);

	// Validation
	const isValid = $derived(
		modelName.trim().length > 0 &&
		(mode === 'edit' || selectedBaseModel.length > 0) &&
		effectiveSystemPrompt.trim().length > 0
	);

	async function handleSubmit(event: Event): Promise<void> {
		event.preventDefault();
		if (!isValid || modelCreationState.isCreating) return;

		const base = mode === 'edit' ? (baseModel || editingModel || '') : selectedBaseModel;
		const success = mode === 'edit'
			? await modelCreationState.update(modelName, base, effectiveSystemPrompt)
			: await modelCreationState.create(modelName, base, effectiveSystemPrompt);

		if (success) {
			// Close after short delay to show success status
			setTimeout(() => {
				onClose();
			}, 500);
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget && !modelCreationState.isCreating) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && !modelCreationState.isCreating) {
			onClose();
		}
	}

	function handleCancel(): void {
		if (modelCreationState.isCreating) {
			modelCreationState.cancel();
		} else {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="model-editor-title"
		tabindex="-1"
	>
		<!-- Dialog -->
		<div class="w-full max-w-lg rounded-xl bg-theme-secondary shadow-xl">
			<div class="border-b border-theme px-6 py-4">
				<h2 id="model-editor-title" class="text-lg font-semibold text-theme-primary">
					{mode === 'edit' ? 'Edit Model System Prompt' : 'Create Custom Model'}
				</h2>
				{#if mode === 'edit'}
					<p class="mt-1 text-xs text-theme-muted">
						This will re-create the model with the new system prompt
					</p>
				{/if}
			</div>

			{#if modelCreationState.isCreating}
				<!-- Progress view -->
				<div class="p-6">
					<div class="flex flex-col items-center justify-center py-8">
						<div class="h-10 w-10 animate-spin rounded-full border-3 border-theme-subtle border-t-violet-500 mb-4"></div>
						<p class="text-sm text-theme-secondary mb-2">
							{mode === 'edit' ? 'Updating model...' : 'Creating model...'}
						</p>
						<p class="text-xs text-theme-muted text-center max-w-xs">
							{modelCreationState.status}
						</p>
					</div>

					<div class="flex justify-center">
						<button
							type="button"
							onclick={handleCancel}
							class="rounded-lg px-4 py-2 text-sm text-red-400 hover:bg-red-900/20"
						>
							Cancel
						</button>
					</div>
				</div>
			{:else if modelCreationState.error}
				<!-- Error view -->
				<div class="p-6">
					<div class="rounded-lg bg-red-900/20 border border-red-500/30 p-4 mb-4">
						<p class="text-sm text-red-400">{modelCreationState.error}</p>
					</div>
					<div class="flex justify-end gap-3">
						<button
							type="button"
							onclick={() => modelCreationState.reset()}
							class="rounded-lg px-4 py-2 text-sm text-theme-secondary hover:bg-theme-tertiary"
						>
							Try Again
						</button>
						<button
							type="button"
							onclick={onClose}
							class="rounded-lg bg-theme-tertiary px-4 py-2 text-sm text-theme-secondary hover:bg-theme-hover"
						>
							Close
						</button>
					</div>
				</div>
			{:else}
				<!-- Form view -->
				<form onsubmit={handleSubmit} class="p-6">
					<div class="space-y-4">
						{#if mode === 'create'}
							<!-- Base model selection -->
							<div>
								<label for="base-model" class="mb-1 block text-sm font-medium text-theme-secondary">
									Base Model <span class="text-red-400">*</span>
								</label>
								<select
									id="base-model"
									bind:value={selectedBaseModel}
									class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
								>
									{#each modelsState.chatModels as model (model.name)}
										<option value={model.name}>{model.name}</option>
									{/each}
								</select>
								<p class="mt-1 text-xs text-theme-muted">
									The model to derive from
								</p>
							</div>
						{/if}

						<!-- Model name -->
						<div>
							<label for="model-name" class="mb-1 block text-sm font-medium text-theme-secondary">
								Model Name <span class="text-red-400">*</span>
							</label>
							<input
								id="model-name"
								type="text"
								bind:value={modelName}
								placeholder="e.g., my-coding-assistant"
								disabled={mode === 'edit'}
								class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-60"
								autocomplete="off"
								autocorrect="off"
								autocapitalize="off"
								spellcheck="false"
							/>
							{#if mode === 'create'}
								<p class="mt-1 text-xs text-theme-muted">
									Use lowercase letters, numbers, and hyphens
								</p>
							{/if}
						</div>

						<!-- System prompt source toggle -->
						<div class="flex items-center gap-4">
							<button
								type="button"
								onclick={() => usePromptLibrary = false}
								class="text-sm {!usePromptLibrary ? 'text-violet-400 font-medium' : 'text-theme-muted hover:text-theme-secondary'}"
							>
								Write prompt
							</button>
							<span class="text-theme-muted">|</span>
							<button
								type="button"
								onclick={() => usePromptLibrary = true}
								class="text-sm {usePromptLibrary ? 'text-violet-400 font-medium' : 'text-theme-muted hover:text-theme-secondary'}"
							>
								Use from library
							</button>
						</div>

						{#if usePromptLibrary}
							<!-- Prompt library selector -->
							<div>
								<label for="prompt-library" class="mb-1 block text-sm font-medium text-theme-secondary">
									Select Prompt <span class="text-red-400">*</span>
								</label>
								<select
									id="prompt-library"
									bind:value={selectedPromptId}
									class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
								>
									<option value={null}>-- Select a prompt --</option>
									{#each promptsState.prompts as prompt (prompt.id)}
										<option value={prompt.id}>{prompt.name}</option>
									{/each}
								</select>
								{#if selectedPromptId}
									{@const selectedPrompt = promptsState.get(selectedPromptId)}
									{#if selectedPrompt}
										<div class="mt-2 rounded-lg bg-theme-tertiary p-3 text-xs text-theme-muted max-h-32 overflow-y-auto">
											{selectedPrompt.content}
										</div>
									{/if}
								{/if}
							</div>
						{:else}
							<!-- System prompt textarea -->
							<div>
								<label for="system-prompt" class="mb-1 block text-sm font-medium text-theme-secondary">
									System Prompt <span class="text-red-400">*</span>
								</label>
								<textarea
									id="system-prompt"
									bind:value={systemPrompt}
									placeholder="You are a helpful assistant that..."
									rows="6"
									class="w-full resize-none rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 font-mono text-sm text-theme-primary placeholder-theme-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
								></textarea>
								<p class="mt-1 text-xs text-theme-muted">
									{systemPrompt.length} characters
								</p>
							</div>
						{/if}
					</div>

					<!-- Actions -->
					<div class="mt-6 flex justify-end gap-3">
						<button
							type="button"
							onclick={handleCancel}
							class="rounded-lg px-4 py-2 text-sm text-theme-secondary hover:bg-theme-tertiary"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!isValid}
							class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{mode === 'edit' ? 'Update Model' : 'Create Model'}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}
