<script lang="ts">
	/**
	 * Model Browser component
	 * Search and download GGUF models from HuggingFace
	 */

	import { onMount } from 'svelte';
	import {
		huggingfaceService,
		type HFModel,
		type HFGGUFFile,
		type DownloadProgress,
		type LocalModel
	} from '$lib/services/huggingface-service.js';

	// Extended file type with recommendation flag
	interface GGUFFileWithRecommend extends HFGGUFFile {
		isRecommended: boolean;
	}

	type SortOption = 'downloads' | 'likes' | 'trending';

	// State
	let searchQuery = $state('');
	let sortBy = $state<SortOption>('downloads');
	let isSearching = $state(false);
	let searchError = $state<string | null>(null);
	let models = $state<HFModel[]>([]);
	let expandedModelId = $state<string | null>(null);
	let modelFiles = $state<Map<string, GGUFFileWithRecommend[]>>(new Map());
	let isLoadingFiles = $state<Set<string>>(new Set());
	let activeDownloads = $state<DownloadProgress[]>([]);

	// Local models state
	let localModels = $state<LocalModel[]>([]);
	let localModelsDirectory = $state<string>('');
	let isLoadingLocalModels = $state(false);
	let localModelsError = $state<string | null>(null);
	let deletingModels = $state<Set<string>>(new Set());

	// SSE unsubscribe functions
	const downloadUnsubscribers = new Map<string, () => void>();

	// Debounce timer
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Derived state
	let hasResults = $derived(models.length > 0);
	let hasActiveDownloads = $derived(activeDownloads.length > 0);
	let inProgressDownloads = $derived(activeDownloads.filter((d) => d.status === 'downloading' || d.status === 'pending'));
	let hasLocalModels = $derived(localModels.length > 0);

	// Recommended quantizations
	const RECOMMENDED_QUANTS = ['Q4_K_M', 'Q5_K_M', 'Q4_K_S', 'Q5_K_S'];

	// Load local models on mount
	onMount(() => {
		loadLocalModels();
	});

	// Load local GGUF models from disk
	async function loadLocalModels(): Promise<void> {
		isLoadingLocalModels = true;
		localModelsError = null;

		try {
			const result = await huggingfaceService.getLocalModels();
			localModels = result.models;
			localModelsDirectory = result.directory;
		} catch (err) {
			localModelsError = err instanceof Error ? err.message : 'Failed to load local models';
		} finally {
			isLoadingLocalModels = false;
		}
	}

	// Delete a local model
	async function deleteLocalModel(filename: string): Promise<void> {
		if (deletingModels.has(filename)) return;

		const newDeleting = new Set(deletingModels);
		newDeleting.add(filename);
		deletingModels = newDeleting;

		try {
			await huggingfaceService.deleteLocalModel(filename);
			localModels = localModels.filter((m) => m.filename !== filename);
		} catch (err) {
			console.error(`Failed to delete ${filename}:`, err);
		} finally {
			const newDeleting = new Set(deletingModels);
			newDeleting.delete(filename);
			deletingModels = newDeleting;
		}
	}

	// Debounced search
	function handleSearchInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		searchQuery = target.value;

		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		debounceTimer = setTimeout(() => {
			if (searchQuery.trim()) {
				performSearch();
			} else {
				models = [];
				searchError = null;
			}
		}, 300);
	}

	// Perform search using HuggingFace service
	async function performSearch(): Promise<void> {
		if (!searchQuery.trim()) return;

		isSearching = true;
		searchError = null;
		expandedModelId = null;

		try {
			const results = await huggingfaceService.searchModels({
				query: searchQuery,
				sort: sortBy,
				limit: 20
			});
			models = results;
		} catch (err) {
			searchError = err instanceof Error ? err.message : 'Search failed';
			models = [];
		} finally {
			isSearching = false;
		}
	}

	// Handle sort change
	function handleSortChange(event: Event): void {
		const target = event.target as HTMLSelectElement;
		sortBy = target.value as SortOption;
		if (searchQuery.trim()) {
			performSearch();
		}
	}

	// Toggle model expansion to show GGUF files
	async function toggleModelExpansion(modelId: string): Promise<void> {
		if (expandedModelId === modelId) {
			expandedModelId = null;
			return;
		}

		expandedModelId = modelId;

		// Load files if not already loaded
		if (!modelFiles.has(modelId)) {
			await loadModelFiles(modelId);
		}
	}

	// Load GGUF files for a model
	async function loadModelFiles(modelId: string): Promise<void> {
		const loadingSet = new Set(isLoadingFiles);
		loadingSet.add(modelId);
		isLoadingFiles = loadingSet;

		try {
			const files = await huggingfaceService.getModelFiles(modelId);
			// Add recommendation flag
			const filesWithRecommend: GGUFFileWithRecommend[] = files.map((f) => ({
				...f,
				isRecommended: RECOMMENDED_QUANTS.includes(f.quantization)
			}));
			const newMap = new Map(modelFiles);
			newMap.set(modelId, filesWithRecommend);
			modelFiles = newMap;
		} catch (err) {
			console.error(`Failed to load files for ${modelId}:`, err);
		} finally {
			const loadingSet = new Set(isLoadingFiles);
			loadingSet.delete(modelId);
			isLoadingFiles = loadingSet;
		}
	}

	// Start download using HuggingFace service
	async function startDownload(modelId: string, file: GGUFFileWithRecommend): Promise<void> {
		// Check if already downloading
		if (activeDownloads.some((d) => d.repo === modelId && d.filename === file.name && (d.status === 'downloading' || d.status === 'pending'))) {
			return;
		}

		try {
			// Start the download
			const downloadId = await huggingfaceService.startDownload(modelId, file.name);

			// Add placeholder entry
			const newDownload: DownloadProgress = {
				id: downloadId,
				repo: modelId,
				filename: file.name,
				status: 'pending',
				progress: 0,
				downloadedBytes: 0,
				totalBytes: file.size,
				speed: 0
			};
			activeDownloads = [...activeDownloads, newDownload];

			// Subscribe to progress updates via SSE
			const unsubscribe = huggingfaceService.subscribeToProgress(downloadId, (progress) => {
				activeDownloads = activeDownloads.map((d) =>
					d.id === downloadId ? progress : d
				);

				// Clean up subscription on terminal state
				if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
					downloadUnsubscribers.delete(downloadId);
					// Refresh local models when download completes
					if (progress.status === 'completed') {
						loadLocalModels();
					}
				}
			});

			downloadUnsubscribers.set(downloadId, unsubscribe);
		} catch (err) {
			console.error(`Failed to start download for ${file.name}:`, err);
		}
	}

	// Cancel download
	async function cancelDownload(downloadId: string): Promise<void> {
		try {
			// Unsubscribe from SSE
			const unsubscribe = downloadUnsubscribers.get(downloadId);
			if (unsubscribe) {
				unsubscribe();
				downloadUnsubscribers.delete(downloadId);
			}
			// Cancel via service
			await huggingfaceService.cancelDownload(downloadId);
			// Update local state
			activeDownloads = activeDownloads.map((d) =>
				d.id === downloadId ? { ...d, status: 'cancelled' as const } : d
			);
		} catch (err) {
			console.error(`Failed to cancel download ${downloadId}:`, err);
		}
	}

	// Remove download from list
	function removeDownload(downloadId: string): void {
		// Clean up subscription if exists
		const unsubscribe = downloadUnsubscribers.get(downloadId);
		if (unsubscribe) {
			unsubscribe();
			downloadUnsubscribers.delete(downloadId);
		}
		activeDownloads = activeDownloads.filter((d) => d.id !== downloadId);
	}

	// Format file size
	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	// Format download speed (bytes/sec to human readable)
	function formatSpeed(bytesPerSec: number): string {
		if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
		if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
		return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
	}

	// Format number with abbreviation
	function formatNumber(num: number): string {
		if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
		if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
		return num.toString();
	}

	// Check if file is already being downloaded
	function isDownloading(modelId: string, filename: string): boolean {
		return activeDownloads.some(
			(d) => d.repo === modelId && d.filename === filename && (d.status === 'downloading' || d.status === 'pending')
		);
	}
</script>

<section class="mb-8">
	<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-5 w-5 text-amber-400"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
			/>
		</svg>
		Model Browser
	</h2>

	<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
		<!-- Active Downloads Section -->
		{#if hasActiveDownloads}
			<div class="space-y-2">
				<h3 class="text-sm font-medium text-theme-primary flex items-center gap-2">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 text-amber-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
						/>
					</svg>
					Active Downloads ({inProgressDownloads.length})
				</h3>

				{#each activeDownloads as download (download.id)}
					<div
						class="rounded-lg border border-theme-subtle bg-theme-tertiary p-3 {download.status === 'completed'
							? 'border-emerald-500/30'
							: download.status === 'failed' || download.status === 'cancelled'
								? 'border-red-500/30'
								: ''}"
					>
						<div class="flex items-center justify-between gap-3 mb-2">
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium text-theme-primary truncate">{download.filename}</p>
								<p class="text-xs text-theme-muted truncate">{download.repo}</p>
							</div>

							<div class="flex items-center gap-2">
								{#if download.status === 'pending'}
									<span class="text-xs text-theme-muted">Starting...</span>
								{:else if download.status === 'downloading'}
									<span class="text-xs text-theme-muted">{formatSpeed(download.speed)}</span>
									<button
										type="button"
										onclick={() => cancelDownload(download.id)}
										class="rounded-lg p-1 text-theme-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
										title="Cancel download"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								{:else if download.status === 'completed'}
									<span class="text-xs text-emerald-400">Completed</span>
									<button
										type="button"
										onclick={() => removeDownload(download.id)}
										class="rounded-lg p-1 text-theme-muted transition-colors hover:bg-theme-hover"
										title="Dismiss"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									</button>
								{:else if download.status === 'failed'}
									<span class="text-xs text-red-400" title={download.error}>Failed</span>
									<button
										type="button"
										onclick={() => removeDownload(download.id)}
										class="rounded-lg p-1 text-theme-muted transition-colors hover:bg-theme-hover"
										title="Dismiss"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								{:else if download.status === 'cancelled'}
									<span class="text-xs text-theme-muted">Cancelled</span>
									<button
										type="button"
										onclick={() => removeDownload(download.id)}
										class="rounded-lg p-1 text-theme-muted transition-colors hover:bg-theme-hover"
										title="Dismiss"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								{/if}
							</div>
						</div>

						{#if download.status === 'downloading'}
							<div class="relative h-2 rounded-full bg-theme-hover overflow-hidden">
								<div
									class="absolute inset-y-0 left-0 bg-amber-500 rounded-full transition-all duration-300"
									style="width: {download.progress}%"
								></div>
							</div>
							<p class="text-xs text-theme-muted mt-1 text-right">{download.progress.toFixed(1)}%</p>
						{/if}
					</div>
				{/each}
			</div>

			<div class="border-t border-theme"></div>
		{/if}

		<!-- Local Models Section -->
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-medium text-theme-primary flex items-center gap-2">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 text-emerald-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
						/>
					</svg>
					Local Models
					{#if hasLocalModels}
						<span class="text-xs text-theme-muted">({localModels.length})</span>
					{/if}
				</h3>
				<button
					type="button"
					onclick={loadLocalModels}
					disabled={isLoadingLocalModels}
					class="rounded-lg p-1.5 text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-secondary disabled:opacity-50"
					title="Refresh local models"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 {isLoadingLocalModels ? 'animate-spin' : ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				</button>
			</div>

			{#if localModelsDirectory}
				<p class="text-xs text-theme-muted">
					Directory: <code class="rounded bg-theme-hover px-1 py-0.5">{localModelsDirectory}</code>
				</p>
			{/if}

			{#if isLoadingLocalModels}
				<div class="flex items-center justify-center py-4">
					<div class="h-4 w-4 animate-spin rounded-full border-2 border-theme-subtle border-t-emerald-500"></div>
					<span class="ml-2 text-xs text-theme-muted">Scanning for local models...</span>
				</div>
			{:else if localModelsError}
				<div class="rounded-lg bg-red-500/20 p-3 text-sm text-red-400 flex items-center gap-2">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 flex-shrink-0"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					{localModelsError}
				</div>
			{:else if !hasLocalModels}
				<div class="rounded-lg border border-dashed border-theme-subtle p-4 text-center">
					<p class="text-xs text-theme-muted">
						No local GGUF models found. Download models below or copy them to the models directory.
					</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each localModels as model (model.filename)}
						{@const isDeleting = deletingModels.has(model.filename)}
						<div class="flex items-center justify-between gap-3 rounded-lg border border-theme-subtle bg-theme-tertiary p-3">
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium text-theme-primary truncate">{model.filename}</p>
								<div class="flex items-center gap-3 mt-0.5 text-xs text-theme-muted">
									<span>{model.sizeFormatted}</span>
									{#if model.quantType}
										<span class="rounded bg-theme-hover px-1.5 py-0.5">{model.quantType}</span>
									{/if}
									<span>Modified: {model.modifiedAt.toLocaleDateString()}</span>
								</div>
							</div>

							<button
								type="button"
								onclick={() => deleteLocalModel(model.filename)}
								disabled={isDeleting}
								class="rounded-lg p-1.5 text-theme-muted transition-colors hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
								title="Delete model"
							>
								{#if isDeleting}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-theme-subtle border-t-red-400"></div>
								{:else}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="border-t border-theme"></div>

		<!-- Search Section -->
		<div class="space-y-3">
			<div class="flex gap-3">
				<!-- Search Input -->
				<div class="relative flex-1">
					<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
						{#if isSearching}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-theme-subtle border-t-amber-500"></div>
						{:else}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 text-theme-muted"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
						{/if}
					</div>
					<input
						type="text"
						value={searchQuery}
						oninput={handleSearchInput}
						placeholder="Search GGUF models on HuggingFace..."
						class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary pl-10 pr-3 py-2 text-sm text-theme-secondary placeholder:text-theme-muted focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
					/>
				</div>

				<!-- Sort Dropdown -->
				<select
					value={sortBy}
					onchange={handleSortChange}
					class="rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-sm text-theme-secondary focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
				>
					<option value="downloads">Most Downloads</option>
					<option value="likes">Most Likes</option>
					<option value="trending">Trending</option>
				</select>
			</div>

			<!-- Results Count -->
			{#if hasResults && !isSearching}
				<p class="text-xs text-theme-muted">
					Found {models.length} model{models.length !== 1 ? 's' : ''}
				</p>
			{/if}
		</div>

		<!-- Error State -->
		{#if searchError}
			<div class="rounded-lg bg-red-500/20 p-3 text-sm text-red-400 flex items-center gap-2">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4 flex-shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				{searchError}
			</div>
		{/if}

		<!-- Empty State (Initial) -->
		{#if !searchQuery.trim() && !hasResults && !isSearching}
			<div class="rounded-lg border border-dashed border-theme-subtle p-8 text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-10 w-10 mx-auto text-theme-muted mb-3"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
					/>
				</svg>
				<p class="text-sm text-theme-muted">
					Search for GGUF models on HuggingFace
				</p>
				<p class="text-xs text-theme-muted mt-1">
					Try searching for "llama", "mistral", "qwen", or "deepseek"
				</p>
			</div>
		{/if}

		<!-- Loading State -->
		{#if isSearching}
			<div class="flex items-center justify-center py-8">
				<div class="h-6 w-6 animate-spin rounded-full border-2 border-theme-subtle border-t-amber-500"></div>
				<span class="ml-2 text-sm text-theme-muted">Searching HuggingFace...</span>
			</div>
		{/if}

		<!-- No Results State -->
		{#if searchQuery.trim() && !hasResults && !isSearching && !searchError}
			<div class="rounded-lg border border-dashed border-theme-subtle p-8 text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-10 w-10 mx-auto text-theme-muted mb-3"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<p class="text-sm text-theme-muted">
					No models found for "{searchQuery}"
				</p>
				<p class="text-xs text-theme-muted mt-1">
					Try a different search term
				</p>
			</div>
		{/if}

		<!-- Model List -->
		{#if hasResults && !isSearching}
			<div class="space-y-2">
				{#each models as model (model.id)}
					{@const isExpanded = expandedModelId === model.id}
					{@const files = modelFiles.get(model.id) ?? []}
					{@const isLoadingFilesForModel = isLoadingFiles.has(model.id)}

					<div class="rounded-lg border border-theme-subtle bg-theme-tertiary overflow-hidden">
						<!-- Model Card Header -->
						<button
							type="button"
							onclick={() => toggleModelExpansion(model.id)}
							class="w-full p-3 text-left transition-colors hover:bg-theme-hover"
						>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<!-- Model Name and Author -->
									<div class="flex items-center gap-2">
										<span class="font-medium text-theme-primary text-sm truncate">
											{model.name}
										</span>
										<span class="text-xs text-theme-muted">
											by {model.author}
										</span>
									</div>

									<!-- Tags -->
									<div class="flex flex-wrap gap-1 mt-2">
										{#each model.tags.slice(0, 5) as tag (tag)}
											<span class="rounded bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-300">
												{tag}
											</span>
										{/each}
										{#if model.tags.length > 5}
											<span class="text-xs text-theme-muted">+{model.tags.length - 5} more</span>
										{/if}
									</div>
								</div>

								<!-- Stats and Expand Icon -->
								<div class="flex items-center gap-4">
									<div class="flex items-center gap-3 text-xs text-theme-muted">
										<span class="flex items-center gap-1" title="Downloads">
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3.5 w-3.5"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												stroke-width="2"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
												/>
											</svg>
											{formatNumber(model.downloads)}
										</span>
										<span class="flex items-center gap-1" title="Likes">
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3.5 w-3.5"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												stroke-width="2"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
												/>
											</svg>
											{formatNumber(model.likes)}
										</span>
									</div>

									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4 text-theme-muted transition-transform {isExpanded ? 'rotate-180' : ''}"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
									</svg>
								</div>
							</div>
						</button>

						<!-- Expanded Files Section -->
						{#if isExpanded}
							<div class="border-t border-theme-subtle bg-theme-secondary p-3">
								{#if isLoadingFilesForModel}
									<div class="flex items-center justify-center py-4">
										<div class="h-4 w-4 animate-spin rounded-full border-2 border-theme-subtle border-t-amber-500"></div>
										<span class="ml-2 text-xs text-theme-muted">Loading files...</span>
									</div>
								{:else if files.length === 0}
									<p class="text-xs text-theme-muted text-center py-4">
										No GGUF files found for this model
									</p>
								{:else}
									<div class="space-y-2">
										<p class="text-xs text-theme-muted mb-2">
											Select a quantization to download:
										</p>
										{#each files as file (file.name)}
											{@const fileIsDownloading = isDownloading(model.id, file.name)}

											<div
												class="flex items-center justify-between gap-3 rounded-lg border border-theme-subtle bg-theme-tertiary p-2 {file.isRecommended
													? 'ring-1 ring-amber-500/50'
													: ''}"
											>
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-2">
														<span class="text-sm text-theme-secondary truncate">
															{file.name}
														</span>
														{#if file.isRecommended}
															<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-400">
																Recommended
															</span>
														{/if}
													</div>
													<div class="flex items-center gap-3 mt-0.5 text-xs text-theme-muted">
														<span>{file.sizeLabel || formatSize(file.size)}</span>
														<span class="rounded bg-theme-hover px-1.5 py-0.5">{file.quantization}</span>
													</div>
												</div>

												<button
													type="button"
													onclick={() => startDownload(model.id, file)}
													disabled={fileIsDownloading}
													class="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
												>
													{#if fileIsDownloading}
														<div class="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
														Downloading
													{:else}
														<svg
															xmlns="http://www.w3.org/2000/svg"
															class="h-3.5 w-3.5"
															fill="none"
															viewBox="0 0 24 24"
															stroke="currentColor"
															stroke-width="2"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
															/>
														</svg>
														Download
													{/if}
												</button>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
