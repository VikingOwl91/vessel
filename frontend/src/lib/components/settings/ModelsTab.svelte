<script lang="ts">
	/**
	 * ModelsTab - Model browser and management
	 * Browse and search models from ollama.com, manage local models
	 */
	import { onMount } from 'svelte';
	import { modelRegistry } from '$lib/stores/model-registry.svelte';
	import { localModelsState } from '$lib/stores/local-models.svelte';
	import { modelsState } from '$lib/stores/models.svelte';
	import { modelOperationsState } from '$lib/stores/model-operations.svelte';
	import { ModelCard } from '$lib/components/models';
	import PullModelDialog from '$lib/components/models/PullModelDialog.svelte';
	import ModelEditorDialog from '$lib/components/models/ModelEditorDialog.svelte';
	import { fetchTagSizes, type RemoteModel } from '$lib/api/model-registry';
	import { modelInfoService, type ModelInfo } from '$lib/services/model-info-service';
	import type { ModelEditorMode } from '$lib/stores/model-creation.svelte';

	// Search debounce
	let searchInput = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleSearchInput(e: Event): void {
		const value = (e.target as HTMLInputElement).value;
		searchInput = value;

		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			modelRegistry.search(value);
		}, 300);
	}

	function handleTypeFilter(type: 'official' | 'community' | ''): void {
		modelRegistry.filterByType(type);
	}

	// Selected model for details panel
	let selectedModel = $state<RemoteModel | null>(null);
	let selectedTag = $state<string>('');
	let pulling = $state(false);
	let pullProgress = $state<{ status: string; completed?: number; total?: number } | null>(null);
	let pullError = $state<string | null>(null);
	let loadingSizes = $state(false);
	let capabilitiesVerified = $state(false);

	async function handleSelectModel(model: RemoteModel): Promise<void> {
		selectedModel = model;
		selectedTag = model.tags[0] || '';
		pullProgress = null;
		pullError = null;
		capabilitiesVerified = false;

		if (!model.tagSizes || Object.keys(model.tagSizes).length === 0) {
			loadingSizes = true;
			try {
				const updatedModel = await fetchTagSizes(model.slug);
				selectedModel = { ...model, tagSizes: updatedModel.tagSizes };
			} catch (err) {
				console.error('Failed to fetch tag sizes:', err);
			} finally {
				loadingSizes = false;
			}
		}

		try {
			const realCapabilities = await modelsState.fetchCapabilities(model.slug);
			if (modelsState.hasCapability(model.slug, 'completion') || realCapabilities.length > 0) {
				selectedModel = { ...selectedModel!, capabilities: realCapabilities };
				capabilitiesVerified = true;
			}
		} catch {
			capabilitiesVerified = false;
		}
	}

	function closeDetails(): void {
		selectedModel = null;
		selectedTag = '';
		pullProgress = null;
		pullError = null;
	}

	async function pullModel(): Promise<void> {
		if (!selectedModel || pulling) return;

		const modelName = selectedTag
			? `${selectedModel.slug}:${selectedTag}`
			: selectedModel.slug;

		pulling = true;
		pullError = null;
		pullProgress = { status: 'Starting pull...' };

		try {
			const response = await fetch('/api/v1/ollama/api/pull', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: modelName })
			});

			if (!response.ok) {
				throw new Error(`Failed to pull model: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const data = JSON.parse(line);
						if (data.error) {
							pullError = data.error;
							break;
						}
						pullProgress = {
							status: data.status || 'Pulling...',
							completed: data.completed,
							total: data.total
						};
					} catch {
						// Skip invalid JSON
					}
				}
			}

			if (!pullError) {
				pullProgress = { status: 'Pull complete!' };
				await modelsState.refresh();
				modelsState.select(modelName);
			}
		} catch (err) {
			pullError = err instanceof Error ? err.message : 'Failed to pull model';
		} finally {
			pulling = false;
		}
	}

	function formatDate(dateStr: string | undefined): string {
		if (!dateStr) return 'Never';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const k = 1024;
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		const value = bytes / Math.pow(k, i);
		return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
	}

	let deleteConfirm = $state<string | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	let modelEditorOpen = $state(false);
	let modelEditorMode = $state<ModelEditorMode>('create');
	let editingModelName = $state<string | undefined>(undefined);
	let editingSystemPrompt = $state<string | undefined>(undefined);
	let editingBaseModel = $state<string | undefined>(undefined);

	let modelInfoCache = $state<Map<string, ModelInfo>>(new Map());

	function openCreateDialog(): void {
		modelEditorMode = 'create';
		editingModelName = undefined;
		editingSystemPrompt = undefined;
		editingBaseModel = undefined;
		modelEditorOpen = true;
	}

	async function openEditDialog(modelName: string): Promise<void> {
		const info = await modelInfoService.getModelInfo(modelName);
		if (!info.systemPrompt) return;

		const localModel = localModelsState.models.find((m) => m.name === modelName);
		const baseModel = localModel?.family || modelName;

		modelEditorMode = 'edit';
		editingModelName = modelName;
		editingSystemPrompt = info.systemPrompt;
		editingBaseModel = baseModel;
		modelEditorOpen = true;
	}

	function closeModelEditor(): void {
		modelEditorOpen = false;
		localModelsState.refresh();
	}

	async function fetchModelInfoForLocalModels(): Promise<void> {
		const newCache = new Map<string, ModelInfo>();
		for (const model of localModelsState.models) {
			try {
				const info = await modelInfoService.getModelInfo(model.name);
				newCache.set(model.name, info);
			} catch {
				// Ignore errors
			}
		}
		modelInfoCache = newCache;
	}

	function hasEmbeddedPrompt(modelName: string): boolean {
		const info = modelInfoCache.get(modelName);
		return info?.systemPrompt !== null && info?.systemPrompt !== undefined && info.systemPrompt.length > 0;
	}

	async function deleteModel(modelName: string): Promise<void> {
		if (deleting) return;

		deleting = true;
		deleteError = null;

		try {
			const response = await fetch('/api/v1/ollama/api/delete', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: modelName })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || `Failed to delete: ${response.statusText}`);
			}

			await localModelsState.refresh();
			await modelsState.refresh();
			deleteConfirm = null;
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete model';
		} finally {
			deleting = false;
		}
	}

	let activeTab = $state<'local' | 'browse'>('local');

	let localSearchInput = $state('');
	let localSearchTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleLocalSearchInput(e: Event): void {
		const value = (e.target as HTMLInputElement).value;
		localSearchInput = value;

		if (localSearchTimeout) clearTimeout(localSearchTimeout);
		localSearchTimeout = setTimeout(() => {
			localModelsState.search(value);
		}, 300);
	}

	$effect(() => {
		if (localModelsState.models.length > 0) {
			fetchModelInfoForLocalModels();
		}
	});

	onMount(() => {
		localModelsState.init();
		modelRegistry.init();
		modelsState.refresh().then(() => {
			modelsState.fetchAllCapabilities();
		});
	});
</script>

<div class="flex h-full overflow-hidden">
	<!-- Main Content -->
	<div class="flex-1 overflow-y-auto">
		<!-- Header -->
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<h2 class="text-xl font-bold text-theme-primary">Models</h2>
				<p class="mt-1 text-sm text-theme-muted">
					Manage local models and browse ollama.com
				</p>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-3">
				{#if activeTab === 'browse' && modelRegistry.syncStatus}
					<div class="text-right text-xs text-theme-muted">
						<div>{modelRegistry.syncStatus.modelCount} models cached</div>
						<div>Last sync: {formatDate(modelRegistry.syncStatus.lastSync ?? undefined)}</div>
					</div>
				{/if}
				{#if activeTab === 'browse'}
					<button
						type="button"
						onclick={() => modelRegistry.sync()}
						disabled={modelRegistry.syncing}
						class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-theme-primary transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if modelRegistry.syncing}
							<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<span>Syncing...</span>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							<span>Sync Models</span>
						{/if}
					</button>
				{:else}
					<button
						type="button"
						onclick={openCreateDialog}
						class="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-theme-primary transition-colors hover:bg-violet-500"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
						</svg>
						<span>Create Custom</span>
					</button>
					<button
						type="button"
						onclick={() => modelOperationsState.openPullDialog()}
						class="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-theme-primary transition-colors hover:bg-sky-500"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
						</svg>
						<span>Pull Model</span>
					</button>
					<button
						type="button"
						onclick={() => localModelsState.checkUpdates()}
						disabled={localModelsState.isCheckingUpdates}
						class="flex items-center gap-2 rounded-lg border border-amber-700 bg-amber-900/20 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if localModelsState.isCheckingUpdates}
							<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<span>Checking...</span>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
							</svg>
							<span>Check Updates</span>
						{/if}
					</button>
					<button
						type="button"
						onclick={() => localModelsState.refresh()}
						disabled={localModelsState.loading}
						class="flex items-center gap-2 rounded-lg border border-theme bg-theme-secondary px-4 py-2 text-sm font-medium text-theme-secondary transition-colors hover:bg-theme-tertiary disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if localModelsState.loading}
							<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
						{/if}
						<span>Refresh</span>
					</button>
				{/if}
			</div>
		</div>

		<!-- Tabs -->
		<div class="mb-6 flex border-b border-theme">
			<button
				type="button"
				onclick={() => activeTab = 'local'}
				class="flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab === 'local'
					? 'border-blue-500 text-blue-400'
					: 'border-transparent text-theme-muted hover:text-theme-primary'}"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
				</svg>
				Local Models
				<span class="rounded-full bg-theme-tertiary px-2 py-0.5 text-xs">{localModelsState.total}</span>
				{#if localModelsState.updatesAvailable > 0}
					<span class="rounded-full bg-amber-600 px-2 py-0.5 text-xs text-theme-primary" title="{localModelsState.updatesAvailable} update{localModelsState.updatesAvailable !== 1 ? 's' : ''} available">
						{localModelsState.updatesAvailable}
					</span>
				{/if}
			</button>
			<button
				type="button"
				onclick={() => activeTab = 'browse'}
				class="flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab === 'browse'
					? 'border-blue-500 text-blue-400'
					: 'border-transparent text-theme-muted hover:text-theme-primary'}"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
				</svg>
				Browse ollama.com
			</button>
		</div>

		<!-- Local Models Tab -->
		{#if activeTab === 'local'}
			{#if deleteError}
				<div class="mb-4 rounded-lg border border-red-900/50 bg-red-900/20 p-4">
					<div class="flex items-center gap-2 text-red-400">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<span>{deleteError}</span>
						<button type="button" onclick={() => deleteError = null} class="ml-auto text-red-400 hover:text-red-300" aria-label="Dismiss error">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>
			{/if}

			<!-- Local Models Search/Filter Bar -->
			<div class="mb-4 flex flex-wrap items-center gap-4">
				<div class="relative flex-1 min-w-[200px]">
					<svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="text"
						value={localSearchInput}
						oninput={handleLocalSearchInput}
						placeholder="Search local models..."
						class="w-full rounded-lg border border-theme bg-theme-secondary py-2 pl-10 pr-4 text-theme-primary placeholder-theme-placeholder focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>

				{#if localModelsState.families.length > 0}
					<select
						value={localModelsState.familyFilter}
						onchange={(e) => localModelsState.filterByFamily((e.target as HTMLSelectElement).value)}
						class="rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						<option value="">All Families</option>
						{#each localModelsState.families as family}
							<option value={family}>{family}</option>
						{/each}
					</select>
				{/if}

				<select
					value={localModelsState.sortBy}
					onchange={(e) => localModelsState.setSort((e.target as HTMLSelectElement).value as import('$lib/api/model-registry').LocalModelSortOption)}
					class="rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
				>
					<option value="name_asc">Name A-Z</option>
					<option value="name_desc">Name Z-A</option>
					<option value="size_desc">Largest</option>
					<option value="size_asc">Smallest</option>
					<option value="modified_desc">Recently Modified</option>
					<option value="modified_asc">Oldest Modified</option>
				</select>

				{#if localModelsState.searchQuery || localModelsState.familyFilter || localModelsState.sortBy !== 'name_asc'}
					<button
						type="button"
						onclick={() => { localModelsState.clearFilters(); localSearchInput = ''; }}
						class="text-sm text-theme-muted hover:text-theme-primary"
					>
						Clear filters
					</button>
				{/if}
			</div>

			{#if localModelsState.loading}
				<div class="space-y-3">
					{#each Array(3) as _}
						<div class="animate-pulse rounded-lg border border-theme bg-theme-secondary p-4">
							<div class="flex items-center justify-between">
								<div class="h-5 w-48 rounded bg-theme-tertiary"></div>
								<div class="h-5 w-20 rounded bg-theme-tertiary"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if localModelsState.models.length === 0}
				<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-12 text-center">
					<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
					</svg>
					<h3 class="mt-4 text-sm font-medium text-theme-muted">
						{#if localModelsState.searchQuery || localModelsState.familyFilter}
							No models match your filters
						{:else}
							No local models
						{/if}
					</h3>
					<p class="mt-1 text-sm text-theme-muted">
						{#if localModelsState.searchQuery || localModelsState.familyFilter}
							Try adjusting your search or filters
						{:else}
							Browse ollama.com to pull models
						{/if}
					</p>
					{#if !localModelsState.searchQuery && !localModelsState.familyFilter}
						<button
							type="button"
							onclick={() => activeTab = 'browse'}
							class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-theme-primary hover:bg-blue-700"
						>
							Browse Models
						</button>
					{/if}
				</div>
			{:else}
				<div class="space-y-2">
					{#each localModelsState.models as model (model.name)}
						{@const caps = modelsState.getCapabilities(model.name) ?? []}
						<div class="group rounded-lg border border-theme bg-theme-secondary p-4 transition-colors hover:border-theme-subtle">
							<div class="flex items-center justify-between">
								<div class="flex-1">
									<div class="flex items-center gap-3">
										<h3 class="font-medium text-theme-primary">{model.name}</h3>
										{#if model.name === modelsState.selectedId}
											<span class="rounded bg-blue-900/50 px-2 py-0.5 text-xs text-blue-300">Selected</span>
										{/if}
										{#if localModelsState.hasUpdate(model.name)}
											<span class="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-theme-primary" title="Update available">
												Update
											</span>
										{/if}
										{#if hasEmbeddedPrompt(model.name)}
											<span class="rounded bg-violet-900/50 px-2 py-0.5 text-xs text-violet-300" title="Custom model with embedded system prompt">
												Custom
											</span>
										{/if}
									</div>
									<div class="mt-1 flex items-center gap-4 text-xs text-theme-muted">
										<span>{formatBytes(model.size)}</span>
										<span>Family: {model.family}</span>
										<span>Parameters: {model.parameterSize}</span>
										<span>Quantization: {model.quantizationLevel}</span>
									</div>
									{#if caps.length > 0}
										<div class="mt-2 flex flex-wrap gap-1.5">
											{#if caps.includes('vision')}
												<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-purple-900/50 text-purple-300">
													<span>👁</span><span>Vision</span>
												</span>
											{/if}
											{#if caps.includes('tools')}
												<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-blue-900/50 text-blue-300">
													<span>🔧</span><span>Tools</span>
												</span>
											{/if}
											{#if caps.includes('thinking')}
												<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-pink-900/50 text-pink-300">
													<span>🧠</span><span>Thinking</span>
												</span>
											{/if}
											{#if caps.includes('embedding')}
												<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-amber-900/50 text-amber-300">
													<span>📊</span><span>Embedding</span>
												</span>
											{/if}
											{#if caps.includes('code')}
												<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-emerald-900/50 text-emerald-300">
													<span>💻</span><span>Code</span>
												</span>
											{/if}
										</div>
									{/if}
								</div>
								<div class="flex items-center gap-2">
									{#if deleteConfirm === model.name}
										<span class="text-sm text-theme-muted">Delete?</span>
										<button
											type="button"
											onclick={() => deleteModel(model.name)}
											disabled={deleting}
											class="rounded bg-red-600 px-3 py-1 text-sm font-medium text-theme-primary hover:bg-red-700 disabled:opacity-50"
										>
											{deleting ? 'Deleting...' : 'Yes'}
										</button>
										<button
											type="button"
											onclick={() => deleteConfirm = null}
											disabled={deleting}
											class="rounded bg-theme-tertiary px-3 py-1 text-sm font-medium text-theme-secondary hover:bg-theme-secondary disabled:opacity-50"
										>
											No
										</button>
									{:else}
										{#if hasEmbeddedPrompt(model.name)}
											<button
												type="button"
												onclick={() => openEditDialog(model.name)}
												class="rounded p-2 text-theme-muted opacity-0 transition-opacity hover:bg-theme-tertiary hover:text-violet-400 group-hover:opacity-100"
												title="Edit system prompt"
											>
												<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
													<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
												</svg>
											</button>
										{/if}
										<button
											type="button"
											onclick={() => deleteConfirm = model.name}
											class="rounded p-2 text-theme-muted opacity-0 transition-opacity hover:bg-theme-tertiary hover:text-red-400 group-hover:opacity-100"
											title="Delete model"
										>
											<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
										</button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>

				{#if localModelsState.totalPages > 1}
					<div class="mt-6 flex items-center justify-center gap-2">
						<button
							type="button"
							onclick={() => localModelsState.prevPage()}
							disabled={!localModelsState.hasPrevPage}
							class="rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary hover:bg-theme-tertiary disabled:cursor-not-allowed disabled:opacity-50"
						>
							← Prev
						</button>
						<span class="px-3 text-sm text-theme-muted">
							Page {localModelsState.currentPage + 1} of {localModelsState.totalPages}
						</span>
						<button
							type="button"
							onclick={() => localModelsState.nextPage()}
							disabled={!localModelsState.hasNextPage}
							class="rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary hover:bg-theme-tertiary disabled:cursor-not-allowed disabled:opacity-50"
						>
							Next →
						</button>
					</div>
				{/if}
			{/if}
		{:else}
			<!-- Browse Tab - Search and Filters -->
			<div class="mb-6 flex flex-wrap items-center gap-4">
				<div class="relative flex-1 min-w-[200px]">
					<svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="text"
						value={searchInput}
						oninput={handleSearchInput}
						placeholder="Search models..."
						class="w-full rounded-lg border border-theme bg-theme-secondary py-2 pl-10 pr-4 text-theme-primary placeholder-theme-placeholder focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>

				<div class="flex rounded-lg border border-theme bg-theme-secondary p-1">
					<button
						type="button"
						onclick={() => handleTypeFilter('')}
						class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {modelRegistry.modelType === ''
							? 'bg-theme-tertiary text-theme-primary'
							: 'text-theme-muted hover:text-theme-primary'}"
					>
						All
					</button>
					<button
						type="button"
						onclick={() => handleTypeFilter('official')}
						class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {modelRegistry.modelType === 'official'
							? 'bg-blue-600 text-theme-primary'
							: 'text-theme-muted hover:text-theme-primary'}"
					>
						Official
					</button>
					<button
						type="button"
						onclick={() => handleTypeFilter('community')}
						class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {modelRegistry.modelType === 'community'
							? 'bg-theme-tertiary text-theme-primary'
							: 'text-theme-muted hover:text-theme-primary'}"
					>
						Community
					</button>
				</div>

				<div class="flex items-center gap-2">
					<label for="sort-select" class="text-sm text-theme-muted">Sort:</label>
					<select
						id="sort-select"
						value={modelRegistry.sortBy}
						onchange={(e) => modelRegistry.setSort((e.target as HTMLSelectElement).value as import('$lib/api/model-registry').ModelSortOption)}
						class="rounded-lg border border-theme bg-theme-secondary px-3 py-1.5 text-sm text-theme-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						<option value="pulls_desc">Most Popular</option>
						<option value="pulls_asc">Least Popular</option>
						<option value="name_asc">Name A-Z</option>
						<option value="name_desc">Name Z-A</option>
						<option value="updated_desc">Recently Updated</option>
					</select>
				</div>

				<div class="text-sm text-theme-muted">
					{modelRegistry.total} model{modelRegistry.total !== 1 ? 's' : ''} found
				</div>
			</div>

			<!-- Capability Filters -->
			<div class="mb-4 flex flex-wrap items-center gap-2">
				<span class="text-sm text-theme-muted">Capabilities:</span>
				<button type="button" onclick={() => modelRegistry.toggleCapability('vision')} class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasCapability('vision') ? 'bg-purple-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">
					<span>👁</span><span>Vision</span>
				</button>
				<button type="button" onclick={() => modelRegistry.toggleCapability('tools')} class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasCapability('tools') ? 'bg-blue-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">
					<span>🔧</span><span>Tools</span>
				</button>
				<button type="button" onclick={() => modelRegistry.toggleCapability('thinking')} class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasCapability('thinking') ? 'bg-pink-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">
					<span>🧠</span><span>Thinking</span>
				</button>
				<button type="button" onclick={() => modelRegistry.toggleCapability('embedding')} class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasCapability('embedding') ? 'bg-amber-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">
					<span>📊</span><span>Embedding</span>
				</button>
				<button type="button" onclick={() => modelRegistry.toggleCapability('cloud')} class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasCapability('cloud') ? 'bg-cyan-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">
					<span>☁️</span><span>Cloud</span>
				</button>
				<span class="ml-2 text-xs text-theme-muted opacity-60">from ollama.com</span>
			</div>

			<!-- Size Range Filters -->
			<div class="mb-4 flex flex-wrap items-center gap-2">
				<span class="text-sm text-theme-muted">Size:</span>
				<button type="button" onclick={() => modelRegistry.toggleSizeRange('small')} class="rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasSizeRange('small') ? 'bg-emerald-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">≤3B</button>
				<button type="button" onclick={() => modelRegistry.toggleSizeRange('medium')} class="rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasSizeRange('medium') ? 'bg-emerald-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">4-13B</button>
				<button type="button" onclick={() => modelRegistry.toggleSizeRange('large')} class="rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasSizeRange('large') ? 'bg-emerald-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">14-70B</button>
				<button type="button" onclick={() => modelRegistry.toggleSizeRange('xlarge')} class="rounded-full px-3 py-1 text-sm transition-colors {modelRegistry.hasSizeRange('xlarge') ? 'bg-emerald-600 text-theme-primary' : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}">>70B</button>
			</div>

			<!-- Family Filter + Clear -->
			<div class="mb-6 flex flex-wrap items-center gap-4">
				{#if modelRegistry.availableFamilies.length > 0}
					<div class="flex items-center gap-2">
						<span class="text-sm text-theme-muted">Family:</span>
						<select
							value={modelRegistry.selectedFamily}
							onchange={(e) => modelRegistry.setFamily((e.target as HTMLSelectElement).value)}
							class="rounded-lg border border-theme bg-theme-secondary px-3 py-1.5 text-sm text-theme-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						>
							<option value="">All Families</option>
							{#each modelRegistry.availableFamilies as family}
								<option value={family}>{family}</option>
							{/each}
						</select>
					</div>
				{/if}

				{#if modelRegistry.selectedCapabilities.length > 0 || modelRegistry.selectedSizeRanges.length > 0 || modelRegistry.selectedFamily || modelRegistry.modelType || modelRegistry.searchQuery || modelRegistry.sortBy !== 'pulls_desc'}
					<button
						type="button"
						onclick={() => { modelRegistry.clearFilters(); searchInput = ''; }}
						class="text-sm text-theme-muted hover:text-theme-primary"
					>
						Clear all filters
					</button>
				{/if}
			</div>

			{#if modelRegistry.error}
				<div class="mb-6 rounded-lg border border-red-900/50 bg-red-900/20 p-4">
					<div class="flex items-center gap-2 text-red-400">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<span>{modelRegistry.error}</span>
					</div>
				</div>
			{/if}

			{#if modelRegistry.loading}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each Array(6) as _}
						<div class="animate-pulse rounded-lg border border-theme bg-theme-secondary p-4">
							<div class="flex items-start justify-between">
								<div class="h-5 w-32 rounded bg-theme-tertiary"></div>
								<div class="h-5 w-16 rounded bg-theme-tertiary"></div>
							</div>
							<div class="mt-3 h-4 w-full rounded bg-theme-tertiary"></div>
							<div class="mt-2 h-4 w-2/3 rounded bg-theme-tertiary"></div>
						</div>
					{/each}
				</div>
			{:else if modelRegistry.models.length === 0}
				<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-12 text-center">
					<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.628.105a9.002 9.002 0 01-9.014 0l-.628-.105c-1.717-.293-2.3-2.379-1.067-3.61L5 14.5" />
					</svg>
					<h3 class="mt-4 text-sm font-medium text-theme-muted">No models found</h3>
					<p class="mt-1 text-sm text-theme-muted">
						{#if modelRegistry.searchQuery || modelRegistry.modelType}
							Try adjusting your search or filters
						{:else}
							Click "Sync Models" to fetch models from ollama.com
						{/if}
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each modelRegistry.models as model (model.slug)}
						<ModelCard {model} onSelect={handleSelectModel} />
					{/each}
				</div>

				{#if modelRegistry.totalPages > 1}
					<div class="mt-6 flex items-center justify-center gap-2">
						<button type="button" onclick={() => modelRegistry.prevPage()} disabled={!modelRegistry.hasPrevPage} class="rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary disabled:cursor-not-allowed disabled:opacity-50" aria-label="Previous page">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
						<span class="text-sm text-theme-muted">Page {modelRegistry.currentPage + 1} of {modelRegistry.totalPages}</span>
						<button type="button" onclick={() => modelRegistry.nextPage()} disabled={!modelRegistry.hasNextPage} class="rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary disabled:cursor-not-allowed disabled:opacity-50" aria-label="Next page">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>
				{/if}
			{/if}
		{/if}
	</div>

	<!-- Model Details Sidebar -->
	{#if selectedModel}
		<div class="w-80 flex-shrink-0 overflow-y-auto border-l border-theme bg-theme-secondary p-4">
			<div class="mb-4 flex items-start justify-between">
				<h3 class="text-lg font-semibold text-theme-primary">{selectedModel.name}</h3>
				<button type="button" onclick={closeDetails} class="rounded p-1 text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary" aria-label="Close details">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="mb-4">
				<span class="rounded px-2 py-1 text-xs {selectedModel.modelType === 'official' ? 'bg-blue-900/50 text-blue-300' : 'bg-theme-tertiary text-theme-muted'}">
					{selectedModel.modelType}
				</span>
			</div>

			{#if selectedModel.description}
				<div class="mb-4">
					<h4 class="mb-2 text-sm font-medium text-theme-secondary">Description</h4>
					<p class="text-sm text-theme-muted">{selectedModel.description}</p>
				</div>
			{/if}

			{#if selectedModel.capabilities.length > 0}
				<div class="mb-4">
					<h4 class="mb-2 flex items-center gap-2 text-sm font-medium text-theme-secondary">
						<span>Capabilities</span>
						{#if capabilitiesVerified}
							<span class="inline-flex items-center gap-1 rounded bg-green-900/30 px-1.5 py-0.5 text-xs text-green-400">✓ verified</span>
						{:else}
							<span class="inline-flex items-center gap-1 rounded bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-400">unverified</span>
						{/if}
					</h4>
					<div class="flex flex-wrap gap-2">
						{#each selectedModel.capabilities as cap}
							<span class="rounded bg-theme-tertiary px-2 py-1 text-xs text-theme-secondary">{cap}</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Pull Section -->
			<div class="mb-4">
				<h4 class="mb-2 text-sm font-medium text-theme-secondary">Pull Model</h4>
				{#if selectedModel.tags.length > 0}
					<select bind:value={selectedTag} disabled={pulling} class="mb-2 w-full rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary disabled:opacity-50">
						{#each selectedModel.tags as tag}
							{@const size = selectedModel.tagSizes?.[tag]}
							<option value={tag}>{selectedModel.slug}:{tag} {size ? `(${formatBytes(size)})` : ''}</option>
						{/each}
					</select>
				{/if}
				<button type="button" onclick={pullModel} disabled={pulling} class="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-theme-primary hover:bg-blue-700 disabled:opacity-50">
					{#if pulling}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
						Pulling...
					{:else}
						Pull Model
					{/if}
				</button>

				{#if pullProgress}
					<div class="mt-2 text-xs text-theme-muted">{pullProgress.status}</div>
					{#if pullProgress.completed !== undefined && pullProgress.total}
						<div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-theme-tertiary">
							<div class="h-full bg-blue-500 transition-all" style="width: {Math.round((pullProgress.completed / pullProgress.total) * 100)}%"></div>
						</div>
					{/if}
				{/if}

				{#if pullError}
					<div class="mt-2 rounded border border-red-900/50 bg-red-900/20 p-2 text-xs text-red-400">{pullError}</div>
				{/if}
			</div>

			<a href={selectedModel.url} target="_blank" rel="noopener noreferrer" class="flex w-full items-center justify-center gap-2 rounded-lg border border-theme bg-theme-secondary px-4 py-2 text-sm text-theme-secondary hover:bg-theme-tertiary">
				View on ollama.com
			</a>
		</div>
	{/if}
</div>

<PullModelDialog />
<ModelEditorDialog isOpen={modelEditorOpen} mode={modelEditorMode} editingModel={editingModelName} currentSystemPrompt={editingSystemPrompt} baseModel={editingBaseModel} onClose={closeModelEditor} />

{#if modelOperationsState.activePulls.size > 0}
	<div class="fixed bottom-0 left-0 right-0 z-40 border-t border-theme bg-theme-secondary/95 p-4 backdrop-blur-sm">
		<div class="mx-auto max-w-4xl space-y-3">
			<h3 class="text-sm font-medium text-theme-secondary">Active Downloads</h3>
			{#each [...modelOperationsState.activePulls.entries()] as [name, pull]}
				<div class="rounded-lg bg-theme-primary/50 p-3">
					<div class="mb-2 flex items-center justify-between">
						<span class="font-medium text-theme-secondary">{name}</span>
						<button type="button" onclick={() => modelOperationsState.cancelPull(name)} class="text-xs text-red-400 hover:text-red-300">Cancel</button>
					</div>
					<div class="mb-1 flex items-center gap-3">
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-theme-tertiary">
							<div class="h-full bg-sky-500 transition-all" style="width: {pull.progress.percent}%"></div>
						</div>
						<span class="text-xs text-theme-muted">{pull.progress.percent}%</span>
					</div>
					<div class="flex items-center justify-between text-xs text-theme-muted">
						<span>{pull.progress.status}</span>
						{#if pull.progress.speed}
							<span>{modelOperationsState.formatBytes(pull.progress.speed)}/s</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
