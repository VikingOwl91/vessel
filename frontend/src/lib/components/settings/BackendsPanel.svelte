<script lang="ts">
	/**
	 * BackendsPanel - Multi-backend LLM management
	 * Configure and switch between Ollama, llama.cpp, and LM Studio
	 */
	import { onMount } from 'svelte';
	import { backendsState, type BackendType, type BackendInfo, type DiscoveryResult } from '$lib/stores/backends.svelte';

	let discovering = $state(false);
	let discoveryResults = $state<DiscoveryResult[]>([]);
	let showDiscoveryResults = $state(false);

	async function handleDiscover(): Promise<void> {
		discovering = true;
		showDiscoveryResults = false;
		try {
			discoveryResults = await backendsState.discover();
			showDiscoveryResults = true;
			// Reload backends after discovery
			await backendsState.load();
		} finally {
			discovering = false;
		}
	}

	async function handleSetActive(type: BackendType): Promise<void> {
		await backendsState.setActive(type);
	}

	function getBackendDisplayName(type: BackendType): string {
		switch (type) {
			case 'ollama':
				return 'Ollama';
			case 'llamacpp':
				return 'llama.cpp';
			case 'lmstudio':
				return 'LM Studio';
			default:
				return type;
		}
	}

	function getBackendDescription(type: BackendType): string {
		switch (type) {
			case 'ollama':
				return 'Full model management - pull, delete, create custom models';
			case 'llamacpp':
				return 'OpenAI-compatible API - models loaded at server startup';
			case 'lmstudio':
				return 'OpenAI-compatible API - manage models via LM Studio app';
			default:
				return '';
		}
	}

	function getDefaultPort(type: BackendType): string {
		switch (type) {
			case 'ollama':
				return '11434';
			case 'llamacpp':
				return '8081';
			case 'lmstudio':
				return '1234';
			default:
				return '';
		}
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'connected':
				return 'bg-green-500';
			case 'disconnected':
				return 'bg-red-500';
			default:
				return 'bg-yellow-500';
		}
	}

	onMount(() => {
		backendsState.load();
	});
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-bold text-theme-primary">AI Backends</h2>
			<p class="mt-1 text-sm text-theme-muted">
				Configure LLM backends: Ollama, llama.cpp server, or LM Studio
			</p>
		</div>
		<button
			type="button"
			onclick={handleDiscover}
			disabled={discovering}
			class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if discovering}
				<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<span>Discovering...</span>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<span>Auto-Detect</span>
			{/if}
		</button>
	</div>

	<!-- Error Message -->
	{#if backendsState.error}
		<div class="rounded-lg border border-red-900/50 bg-red-900/20 p-4">
			<div class="flex items-center gap-2 text-red-400">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span>{backendsState.error}</span>
				<button type="button" onclick={() => backendsState.clearError()} class="ml-auto text-red-400 hover:text-red-300">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>
	{/if}

	<!-- Discovery Results -->
	{#if showDiscoveryResults && discoveryResults.length > 0}
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<h3 class="mb-3 text-sm font-medium text-theme-secondary">Discovery Results</h3>
			<div class="space-y-2">
				{#each discoveryResults as result}
					<div class="flex items-center justify-between rounded-lg bg-theme-tertiary/50 px-3 py-2">
						<div class="flex items-center gap-3">
							<span class="h-2 w-2 rounded-full {result.available ? 'bg-green-500' : 'bg-red-500'}"></span>
							<span class="text-sm text-theme-primary">{getBackendDisplayName(result.type)}</span>
							<span class="text-xs text-theme-muted">{result.baseUrl}</span>
						</div>
						<span class="text-xs {result.available ? 'text-green-400' : 'text-red-400'}">
							{result.available ? 'Available' : result.error || 'Not found'}
						</span>
					</div>
				{/each}
			</div>
			<button
				type="button"
				onclick={() => showDiscoveryResults = false}
				class="mt-3 text-xs text-theme-muted hover:text-theme-primary"
			>
				Dismiss
			</button>
		</div>
	{/if}

	<!-- Active Backend Info -->
	{#if backendsState.activeBackend}
		<div class="rounded-lg border border-blue-900/50 bg-blue-900/20 p-4">
			<div class="flex items-center gap-2 text-blue-400">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span class="font-medium">Active: {getBackendDisplayName(backendsState.activeBackend.type)}</span>
				{#if backendsState.activeBackend.version}
					<span class="text-xs text-blue-300/70">v{backendsState.activeBackend.version}</span>
				{/if}
			</div>
			<p class="mt-1 text-sm text-blue-300/70">{backendsState.activeBackend.baseUrl}</p>

			<!-- Capabilities -->
			<div class="mt-3 flex flex-wrap gap-2">
				{#if backendsState.canPullModels}
					<span class="rounded bg-green-900/30 px-2 py-1 text-xs text-green-400">Pull Models</span>
				{/if}
				{#if backendsState.canDeleteModels}
					<span class="rounded bg-green-900/30 px-2 py-1 text-xs text-green-400">Delete Models</span>
				{/if}
				{#if backendsState.canCreateModels}
					<span class="rounded bg-green-900/30 px-2 py-1 text-xs text-green-400">Create Custom</span>
				{/if}
				{#if backendsState.activeBackend.capabilities.canStreamChat}
					<span class="rounded bg-blue-900/30 px-2 py-1 text-xs text-blue-400">Streaming</span>
				{/if}
				{#if backendsState.activeBackend.capabilities.canEmbed}
					<span class="rounded bg-purple-900/30 px-2 py-1 text-xs text-purple-400">Embeddings</span>
				{/if}
			</div>
		</div>
	{:else if !backendsState.isLoading}
		<div class="rounded-lg border border-amber-900/50 bg-amber-900/20 p-4">
			<div class="flex items-center gap-2 text-amber-400">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<span>No active backend configured. Click "Auto-Detect" to find available backends.</span>
			</div>
		</div>
	{/if}

	<!-- Backend Cards -->
	<div class="space-y-4">
		<h3 class="text-sm font-medium text-theme-secondary">Available Backends</h3>

		{#if backendsState.isLoading}
			<div class="space-y-3">
				{#each Array(3) as _}
					<div class="animate-pulse rounded-lg border border-theme bg-theme-secondary p-4">
						<div class="flex items-center gap-4">
							<div class="h-10 w-10 rounded-lg bg-theme-tertiary"></div>
							<div class="flex-1">
								<div class="h-5 w-32 rounded bg-theme-tertiary"></div>
								<div class="mt-2 h-4 w-48 rounded bg-theme-tertiary"></div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if backendsState.backends.length === 0}
			<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
				</svg>
				<h3 class="mt-4 text-sm font-medium text-theme-muted">No backends configured</h3>
				<p class="mt-1 text-sm text-theme-muted">
					Click "Auto-Detect" to scan for available LLM backends
				</p>
			</div>
		{:else}
			{#each backendsState.backends as backend}
				{@const isActive = backendsState.activeType === backend.type}
				<div class="rounded-lg border transition-colors {isActive ? 'border-blue-500 bg-blue-900/10' : 'border-theme bg-theme-secondary hover:border-theme-subtle'}">
					<div class="p-4">
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-4">
								<!-- Backend Icon -->
								<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-theme-tertiary">
									{#if backend.type === 'ollama'}
										<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-theme-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
										</svg>
									{:else if backend.type === 'llamacpp'}
										<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-theme-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
										</svg>
									{:else}
										<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-theme-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
										</svg>
									{/if}
								</div>

								<div>
									<div class="flex items-center gap-2">
										<h4 class="font-medium text-theme-primary">{getBackendDisplayName(backend.type)}</h4>
										<span class="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs {backend.status === 'connected' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}">
											<span class="h-1.5 w-1.5 rounded-full {getStatusColor(backend.status)}"></span>
											{backend.status}
										</span>
										{#if isActive}
											<span class="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">Active</span>
										{/if}
									</div>
									<p class="mt-1 text-sm text-theme-muted">{getBackendDescription(backend.type)}</p>
									<p class="mt-1 text-xs text-theme-muted/70">{backend.baseUrl}</p>
								</div>
							</div>

							<div class="flex items-center gap-2">
								{#if !isActive && backend.status === 'connected'}
									<button
										type="button"
										onclick={() => handleSetActive(backend.type)}
										class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
									>
										Set Active
									</button>
								{/if}
							</div>
						</div>

						{#if backend.error}
							<div class="mt-3 rounded bg-red-900/20 px-3 py-2 text-xs text-red-400">
								{backend.error}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Help Section -->
	<div class="rounded-lg border border-theme bg-theme-secondary/50 p-4">
		<h3 class="text-sm font-medium text-theme-secondary">Quick Start</h3>
		<div class="mt-2 space-y-2 text-sm text-theme-muted">
			<p><strong>Ollama:</strong> Run <code class="rounded bg-theme-tertiary px-1.5 py-0.5 text-xs">ollama serve</code> (default port 11434)</p>
			<p><strong>llama.cpp:</strong> Run <code class="rounded bg-theme-tertiary px-1.5 py-0.5 text-xs">llama-server -m model.gguf</code> (default port 8081)</p>
			<p><strong>LM Studio:</strong> Start local server from the app (default port 1234)</p>
		</div>
	</div>
</div>
