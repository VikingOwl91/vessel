<script lang="ts">
	/**
	 * Backend settings component.
	 * Manages LLM backend configuration: add, remove, enable/disable, select primary.
	 */

	import { backendsState, type RegisterBackendOptions } from '$lib/stores';
	import type { BackendType } from '$lib/backends/types.js';

	// Add backend form state
	let showAddForm = $state(false);
	let newBackend = $state<{
		type: BackendType;
		name: string;
		baseUrl: string;
	}>({
		type: 'ollama',
		name: '',
		baseUrl: ''
	});
	let isAdding = $state(false);
	let addError = $state<string | null>(null);

	// Refresh state
	let isRefreshing = $state(false);

	// Backend type options
	const backendTypes: { value: BackendType; label: string; defaultUrl: string }[] = [
		{ value: 'ollama', label: 'Ollama', defaultUrl: 'http://localhost:11434' },
		{ value: 'llama-cpp-server', label: 'llama.cpp Server', defaultUrl: 'http://localhost:8080' },
		{ value: 'vlm', label: 'VLM (llama.cpp)', defaultUrl: '' }
	];

	// Get default URL for backend type
	function getDefaultUrl(type: BackendType): string {
		return backendTypes.find((t) => t.value === type)?.defaultUrl ?? '';
	}

	// Handle type change - update default URL
	function handleTypeChange(): void {
		if (!newBackend.baseUrl || backendTypes.some((t) => t.defaultUrl === newBackend.baseUrl)) {
			newBackend.baseUrl = getDefaultUrl(newBackend.type);
		}
	}

	// Generate unique ID for backend
	function generateId(type: BackendType, name: string): string {
		const baseName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		return `${type}-${baseName}-${Date.now().toString(36)}`;
	}

	// Add new backend
	async function handleAddBackend(): Promise<void> {
		if (!newBackend.name.trim()) {
			addError = 'Name is required';
			return;
		}

		isAdding = true;
		addError = null;

		try {
			const options: RegisterBackendOptions = {
				id: generateId(newBackend.type, newBackend.name),
				type: newBackend.type,
				name: newBackend.name.trim(),
				baseUrl: newBackend.baseUrl.trim() || undefined,
				enabled: true,
				priority: backendsState.all.length + 1
			};

			await backendsState.registerBackend(options);

			// Reset form
			newBackend = { type: 'ollama', name: '', baseUrl: '' };
			showAddForm = false;
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add backend';
		} finally {
			isAdding = false;
		}
	}

	// Remove backend
	function handleRemoveBackend(id: string): void {
		if (confirm('Remove this backend?')) {
			backendsState.unregisterBackend(id);
		}
	}

	// Toggle backend enabled state
	function handleToggleEnabled(id: string, enabled: boolean): void {
		backendsState.setEnabled(id, !enabled);
	}

	// Set primary backend
	function handleSetPrimary(id: string): void {
		backendsState.setPrimary(id);
	}

	// Refresh all backend status
	async function handleRefreshStatus(): Promise<void> {
		isRefreshing = true;
		try {
			await backendsState.refreshAllStatus();
		} finally {
			isRefreshing = false;
		}
	}

	// Format bytes to human readable
	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	// Get status color class
	function getStatusColor(available: boolean): string {
		return available ? 'bg-emerald-500' : 'bg-red-500';
	}

	// Get backend type label
	function getTypeLabel(type: BackendType): string {
		return backendTypes.find((t) => t.value === type)?.label ?? type;
	}
</script>

<section class="mb-8">
	<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-5 w-5 text-blue-400"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
			/>
		</svg>
		LLM Backends
	</h2>

	<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
		<!-- Header with refresh button -->
		<div class="flex items-center justify-between">
			<p class="text-sm text-theme-muted">
				Configure LLM backends for chat and inference
			</p>
			<button
				type="button"
				onclick={handleRefreshStatus}
				disabled={isRefreshing}
				class="flex items-center gap-1.5 rounded-lg bg-theme-tertiary px-3 py-1.5 text-xs font-medium text-theme-secondary transition-colors hover:bg-theme-hover disabled:opacity-50"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4 {isRefreshing ? 'animate-spin' : ''}"
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
				{isRefreshing ? 'Refreshing...' : 'Refresh Status'}
			</button>
		</div>

		<!-- Backend list -->
		{#if backendsState.all.length === 0}
			<div class="rounded-lg border border-dashed border-theme-subtle p-6 text-center">
				<p class="text-sm text-theme-muted">No backends configured</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each backendsState.all as backend (backend.id)}
					<div
						class="rounded-lg border border-theme-subtle bg-theme-tertiary p-3 transition-colors {backend.id ===
						backendsState.primaryId
							? 'ring-2 ring-blue-500/50'
							: ''}"
					>
						<div class="flex items-start justify-between gap-3">
							<!-- Backend info -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<!-- Status indicator -->
									<span
										class="h-2 w-2 rounded-full {getStatusColor(backend.status.available)}"
										title={backend.status.available ? 'Available' : 'Unavailable'}
									></span>

									<!-- Name -->
									<span class="font-medium text-theme-primary truncate">
										{backend.name}
									</span>

									<!-- Primary badge -->
									{#if backend.id === backendsState.primaryId}
										<span
											class="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400"
										>
											Primary
										</span>
									{/if}

									<!-- Type badge -->
									<span
										class="rounded-full bg-theme-hover px-2 py-0.5 text-xs text-theme-muted"
									>
										{getTypeLabel(backend.type)}
									</span>
								</div>

								<!-- Status details -->
								<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-theme-muted">
									{#if backend.status.version}
										<span>v{backend.status.version}</span>
									{/if}
									{#if backend.status.loadedModel}
										<span>Model: {backend.status.loadedModel}</span>
									{/if}
									{#if backend.status.gpuMemoryUsed}
										<span>VRAM: {formatBytes(backend.status.gpuMemoryUsed)}</span>
									{/if}
									{#if !backend.status.available}
										<span class="text-red-400">Offline</span>
									{/if}
								</div>
							</div>

							<!-- Actions -->
							<div class="flex items-center gap-2">
								<!-- Set as primary button -->
								{#if backend.id !== backendsState.primaryId && backend.enabled}
									<button
										type="button"
										onclick={() => handleSetPrimary(backend.id)}
										class="rounded-lg bg-theme-hover px-2 py-1 text-xs font-medium text-theme-secondary transition-colors hover:bg-blue-500/20 hover:text-blue-400"
										title="Set as primary backend"
									>
										Set Primary
									</button>
								{/if}

								<!-- Enable/disable toggle -->
								<button
									type="button"
									onclick={() => handleToggleEnabled(backend.id, backend.enabled)}
									class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-theme {backend.enabled
										? 'bg-blue-600'
										: 'bg-theme-hover'}"
									role="switch"
									aria-checked={backend.enabled}
									aria-label="Enable backend"
								>
									<span
										class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {backend.enabled
											? 'translate-x-4'
											: 'translate-x-0'}"
									></span>
								</button>

								<!-- Remove button (not for default) -->
								{#if backend.id !== 'ollama-default'}
									<button
										type="button"
										onclick={() => handleRemoveBackend(backend.id)}
										class="rounded-lg p-1 text-theme-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
										title="Remove backend"
									>
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
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Add backend button/form -->
		{#if showAddForm}
			<div class="rounded-lg border border-theme-subtle bg-theme-tertiary p-4 space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-theme-primary">Add Backend</h3>
					<button
						type="button"
						onclick={() => {
							showAddForm = false;
							addError = null;
						}}
						class="text-theme-muted hover:text-theme-secondary"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<!-- Error message -->
				{#if addError}
					<div class="rounded-lg bg-red-500/20 p-2 text-sm text-red-400">
						{addError}
					</div>
				{/if}

				<!-- Backend type -->
				<div>
					<label for="backend-type" class="block text-xs font-medium text-theme-muted mb-1">
						Type
					</label>
					<select
						id="backend-type"
						bind:value={newBackend.type}
						onchange={handleTypeChange}
						class="w-full rounded-lg border border-theme-subtle bg-theme-secondary px-3 py-2 text-sm text-theme-secondary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						{#each backendTypes as type}
							<option value={type.value}>{type.label}</option>
						{/each}
					</select>
				</div>

				<!-- Name -->
				<div>
					<label for="backend-name" class="block text-xs font-medium text-theme-muted mb-1">
						Name
					</label>
					<input
						id="backend-name"
						type="text"
						bind:value={newBackend.name}
						placeholder="My Backend"
						class="w-full rounded-lg border border-theme-subtle bg-theme-secondary px-3 py-2 text-sm text-theme-secondary placeholder:text-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
				</div>

				<!-- Base URL -->
				<div>
					<label for="backend-url" class="block text-xs font-medium text-theme-muted mb-1">
						Base URL
					</label>
					<input
						id="backend-url"
						type="text"
						bind:value={newBackend.baseUrl}
						placeholder={getDefaultUrl(newBackend.type)}
						class="w-full rounded-lg border border-theme-subtle bg-theme-secondary px-3 py-2 text-sm text-theme-secondary placeholder:text-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
					<p class="mt-1 text-xs text-theme-muted">
						Leave empty for default: {getDefaultUrl(newBackend.type)}
					</p>
				</div>

				<!-- Submit button -->
				<button
					type="button"
					onclick={handleAddBackend}
					disabled={isAdding}
					class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
				>
					{isAdding ? 'Adding...' : 'Add Backend'}
				</button>
			</div>
		{:else}
			<button
				type="button"
				onclick={() => {
					showAddForm = true;
					newBackend.baseUrl = getDefaultUrl(newBackend.type);
				}}
				class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-theme-subtle p-3 text-sm text-theme-muted transition-colors hover:border-blue-500 hover:text-blue-400"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				Add Backend
			</button>
		{/if}
	</div>
</section>
