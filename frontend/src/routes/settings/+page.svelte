<script lang="ts">
	/**
	 * Settings Hub
	 * Consolidated settings page with tab-based navigation
	 */
	import { page } from '$app/stores';
	import {
		SettingsTabs,
		GeneralTab,
		ModelsTab,
		PromptsTab,
		ToolsTab,
		AgentsTab,
		KnowledgeTab,
		MemoryTab,
		AboutTab,
		type SettingsTab
	} from '$lib/components/settings';

	// Get active tab from URL query parameter
	let activeTab = $derived<SettingsTab>(
		($page.url.searchParams.get('tab') as SettingsTab) || 'general'
	);
</script>

<div class="flex h-full flex-col overflow-hidden bg-theme-primary">
	<!-- Tab Navigation -->
	<div class="shrink-0 border-b border-theme bg-theme-secondary/50 px-6 pt-4">
		<div class="mx-auto max-w-5xl">
			<h1 class="mb-4 text-2xl font-bold text-theme-primary">Settings</h1>
			<SettingsTabs />
		</div>
	</div>

	<!-- Tab Content -->
	<div class="flex-1 overflow-y-auto p-6">
		<div class="mx-auto max-w-5xl">
			{#if activeTab === 'general'}
				<GeneralTab />
			{:else if activeTab === 'models'}
				<ModelsTab />
			{:else if activeTab === 'prompts'}
				<PromptsTab />
			{:else if activeTab === 'tools'}
				<ToolsTab />
			{:else if activeTab === 'agents'}
				<AgentsTab />
			{:else if activeTab === 'knowledge'}
				<KnowledgeTab />
			{:else if activeTab === 'memory'}
				<MemoryTab />
			{:else if activeTab === 'about'}
				<AboutTab />
			{/if}
		</div>
	</div>
</div>
