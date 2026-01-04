<script lang="ts">
	/**
	 * ModelSelect.svelte - Dropdown for selecting models from the primary backend
	 * Supports Ollama (dynamic model switching) and llama.cpp (single loaded model)
	 */
	import { modelsState } from '$lib/stores';
	import { backendsState } from '$lib/stores/backends.svelte';
	import type { ModelInfo } from '$lib/backends/types';
	import ModelCapabilityIcons from './ModelCapabilityIcons.svelte';
	import { onMount } from 'svelte';

	/** Track dropdown open state */
	let isOpen = $state(false);

	/** Reference to the dropdown for click-outside detection */
	let dropdownRef: HTMLDivElement | undefined = $state();

	/** Models from the primary backend */
	let backendModels = $state<ModelInfo[]>([]);
	let isLoadingBackendModels = $state(false);
	let backendModelsError = $state<string | null>(null);

	/** Derived: The primary backend type */
	const primaryBackendType = $derived(
		backendsState.primaryId ? backendsState.all.find((b) => b.id === backendsState.primaryId)?.type : null
	);

	/** Derived: Whether we should use Ollama models (legacy flow) */
	const useOllamaModels = $derived(primaryBackendType === 'ollama' || !primaryBackendType);

	/** Load models from the primary backend */
	async function loadBackendModels() {
		const client = backendsState.primary;
		if (!client || primaryBackendType === 'ollama') {
			// For Ollama, use the existing modelsState
			return;
		}

		isLoadingBackendModels = true;
		backendModelsError = null;

		try {
			backendModels = await client.listModels();
		} catch (err) {
			backendModelsError = err instanceof Error ? err.message : 'Failed to load models';
			console.error('Failed to load models from backend:', err);
		} finally {
			isLoadingBackendModels = false;
		}
	}

	/** Refresh models when primary backend changes */
	$effect(() => {
		if (backendsState.primaryId && !useOllamaModels) {
			loadBackendModels();
		}
	});

	onMount(() => {
		if (!useOllamaModels) {
			loadBackendModels();
		}
	});

	/** Format model size for display */
	function formatSize(bytes: number): string {
		if (!bytes) return '';
		const gb = bytes / (1024 * 1024 * 1024);
		if (gb >= 1) {
			return `${gb.toFixed(1)} GB`;
		}
		const mb = bytes / (1024 * 1024);
		return `${mb.toFixed(0)} MB`;
	}

	/** Handle model selection */
	function selectModel(modelName: string) {
		modelsState.select(modelName);
		isOpen = false;
	}

	/** Handle click outside to close dropdown */
	function handleClickOutside(event: MouseEvent) {
		if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	/** Add/remove click listener based on open state */
	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
		} else {
			document.removeEventListener('click', handleClickOutside);
		}

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	/** Derived: Is loading (for either backend type) */
	const isLoading = $derived(useOllamaModels ? modelsState.isLoading : isLoadingBackendModels);

	/** Derived: Error message */
	const error = $derived(useOllamaModels ? modelsState.error : backendModelsError);

	/** Derived: Selected model display info */
	const selectedDisplay = $derived.by(() => {
		if (useOllamaModels) {
			return modelsState.selected
				? { name: modelsState.selected.name, paramSize: modelsState.selected.details.parameter_size }
				: null;
		} else {
			// For non-Ollama backends, show the first/only model
			const model = backendModels[0];
			return model ? { name: model.name, paramSize: model.parameterSize || '' } : null;
		}
	});

	/** Derived: Backend name for display */
	const backendName = $derived(
		backendsState.all.find((b) => b.id === backendsState.primaryId)?.name ?? 'LLM'
	);
</script>

<div bind:this={dropdownRef} class="relative">
	<!-- Trigger button -->
	<button
		type="button"
		onclick={() => (isOpen = !isOpen)}
		disabled={isLoading}
		class="flex min-w-[180px] items-center justify-between gap-2 rounded-lg border border-theme bg-theme-secondary/50 px-3 py-2 text-sm transition-colors hover:bg-theme-secondary disabled:cursor-not-allowed disabled:opacity-50"
	>
		<div class="flex items-center gap-2">
			<!-- Model icon -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4 text-emerald-500"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
				/>
			</svg>

			{#if isLoading}
				<span class="text-theme-muted">Loading models...</span>
			{:else if selectedDisplay}
				<div class="flex flex-col items-start">
					<div class="flex items-center gap-1.5">
						<span class="text-theme-secondary">{selectedDisplay.name}</span>
						<!-- Capability icons (only for Ollama) -->
						{#if useOllamaModels}
							<ModelCapabilityIcons modelName={selectedDisplay.name} />
						{/if}
					</div>
					{#if selectedDisplay.paramSize}
						<span class="text-xs text-theme-muted">{selectedDisplay.paramSize}</span>
					{:else if !useOllamaModels}
						<span class="text-xs text-theme-muted">{backendName}</span>
					{/if}
				</div>
			{:else if error}
				<span class="text-red-400">Error loading models</span>
			{:else}
				<span class="text-theme-muted">Select a model</span>
			{/if}
		</div>

		<!-- Chevron icon -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4 text-theme-muted transition-transform"
			class:rotate-180={isOpen}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
		>
			<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
		</svg>
	</button>

	<!-- Dropdown menu -->
	{#if isOpen && !isLoading}
		<div
			class="absolute left-0 top-full z-[100] mt-1 max-h-80 min-w-[280px] overflow-y-auto rounded-lg border border-theme bg-theme-primary py-1 shadow-xl"
		>
			{#if error}
				<div class="px-3 py-4 text-center text-sm text-red-400">
					<p>{error}</p>
					<button
						type="button"
						onclick={() => useOllamaModels ? modelsState.refresh() : loadBackendModels()}
						class="mt-2 text-emerald-500 hover:text-emerald-400"
					>
						Retry
					</button>
				</div>
			{:else if useOllamaModels}
				<!-- Ollama: Show grouped models with full selection capability -->
				{#if modelsState.grouped.length === 0}
					<div class="px-3 py-4 text-center text-sm text-theme-muted">
						<p>No models available</p>
						<p class="mt-1 text-xs">Make sure Ollama is running</p>
					</div>
				{:else}
					{#each modelsState.grouped as group (group.family)}
						<!-- Group header -->
						<div class="sticky top-0 bg-theme-primary px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-theme-muted">
							{group.family}
						</div>

						<!-- Models in group -->
						{#each group.models as model (model.name)}
							<button
								type="button"
								onclick={() => selectModel(model.name)}
								class="flex w-full items-center justify-between px-3 py-2 text-left transition-colors {modelsState.selectedId === model.name ? 'bg-emerald-900/30 text-emerald-400' : 'hover:bg-theme-secondary'}"
							>
								<div class="flex flex-col">
									<div class="flex items-center gap-1.5">
										<span class="text-sm" class:text-theme-secondary={modelsState.selectedId !== model.name}>
											{model.name}
										</span>
										<!-- Capability icons for models in dropdown -->
										<ModelCapabilityIcons modelName={model.name} compact />
									</div>
									<span class="text-xs text-theme-muted">
										{model.details.parameter_size}
										{#if model.details.quantization_level}
											- {model.details.quantization_level}
										{/if}
									</span>
								</div>

								<div class="flex items-center gap-2 text-xs text-theme-muted">
									<span>{formatSize(model.size)}</span>
									{#if modelsState.selectedId === model.name}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4 text-emerald-500"
											viewBox="0 0 20 20"
											fill="currentColor"
										>
											<path
												fill-rule="evenodd"
												d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
												clip-rule="evenodd"
											/>
										</svg>
									{/if}
								</div>
							</button>
						{/each}
					{/each}
				{/if}
			{:else}
				<!-- Non-Ollama backend (llama.cpp): Show loaded model(s) -->
				{#if backendModels.length === 0}
					<div class="px-3 py-4 text-center text-sm text-theme-muted">
						<p>No model loaded</p>
						<p class="mt-1 text-xs">Load a model in {backendName}</p>
					</div>
				{:else}
					<!-- Header showing backend type -->
					<div class="sticky top-0 bg-theme-primary px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-theme-muted">
						{backendName} - Loaded Model
					</div>

					{#each backendModels as model (model.name)}
						<div
							class="flex w-full items-center justify-between bg-emerald-900/30 px-3 py-2 text-left text-emerald-400"
						>
							<div class="flex flex-col">
								<div class="flex items-center gap-1.5">
									<span class="text-sm">{model.name}</span>
								</div>
								{#if model.parameterSize || model.quantLevel}
									<span class="text-xs text-theme-muted">
										{model.parameterSize ?? ''}
										{#if model.parameterSize && model.quantLevel} - {/if}
										{model.quantLevel ?? ''}
									</span>
								{/if}
							</div>

							<div class="flex items-center gap-2 text-xs text-theme-muted">
								{#if model.size}
									<span>{formatSize(model.size)}</span>
								{/if}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 text-emerald-500"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path
										fill-rule="evenodd"
										d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
						</div>
					{/each}

					<!-- Info message about model switching -->
					<div class="border-t border-theme px-3 py-2 text-xs text-theme-muted">
						<p>Model is loaded at server startup.</p>
						<p>Restart {backendName} to switch models.</p>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
