<script lang="ts">
	/**
	 * AIProvidersTab - Combined Backends and Models management
	 * Sub-tabs for backend configuration and model management
	 * Models sub-tab only available when Ollama is active
	 */
	import { backendsState } from '$lib/stores/backends.svelte';
	import BackendsPanel from './BackendsPanel.svelte';
	import ModelsTab from './ModelsTab.svelte';

	type SubTab = 'backends' | 'models';

	let activeSubTab = $state<SubTab>('backends');

	// Models tab only available for Ollama
	const isOllamaActive = $derived(backendsState.activeType === 'ollama');

	// If Models tab is active but Ollama is no longer active, switch to Backends
	$effect(() => {
		if (activeSubTab === 'models' && !isOllamaActive) {
			activeSubTab = 'backends';
		}
	});
</script>

<div class="space-y-6">
	<!-- Sub-tab Navigation -->
	<div class="flex gap-1 border-b border-theme">
		<button
			type="button"
			onclick={() => (activeSubTab = 'backends')}
			class="flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeSubTab === 'backends'
				? 'border-violet-500 text-violet-400'
				: 'border-transparent text-theme-muted hover:border-theme hover:text-theme-primary'}"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2M5 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2m-2-4h.01M17 16h.01" />
			</svg>
			Backends
		</button>
		{#if isOllamaActive}
			<button
				type="button"
				onclick={() => (activeSubTab = 'models')}
				class="flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeSubTab === 'models'
					? 'border-violet-500 text-violet-400'
					: 'border-transparent text-theme-muted hover:border-theme hover:text-theme-primary'}"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z" />
				</svg>
				Models
			</button>
		{:else}
			<span
				class="flex cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm font-medium text-theme-muted/50"
				title="Models tab only available when Ollama is the active backend"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z" />
				</svg>
				Models
				<span class="text-xs">(Ollama only)</span>
			</span>
		{/if}
	</div>

	<!-- Sub-tab Content -->
	{#if activeSubTab === 'backends'}
		<BackendsPanel />
	{:else if activeSubTab === 'models'}
		<ModelsTab />
	{/if}
</div>
