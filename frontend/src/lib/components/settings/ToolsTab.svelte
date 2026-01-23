<script lang="ts">
	/**
	 * ToolsTab - Enhanced tools management with better visuals
	 */
	import { toolsState } from '$lib/stores';
	import type { ToolDefinition, CustomTool } from '$lib/tools';
	import { ToolEditor } from '$lib/components/tools';
	import { ConfirmDialog } from '$lib/components/shared';

	let showEditor = $state(false);
	let editingTool = $state<CustomTool | null>(null);
	let searchQuery = $state('');
	let expandedDescriptions = $state<Set<string>>(new Set());
	let deleteConfirm = $state<{ show: boolean; tool: CustomTool | null }>({ show: false, tool: null });

	function openCreateEditor(): void {
		editingTool = null;
		showEditor = true;
	}

	function openEditEditor(tool: CustomTool): void {
		editingTool = tool;
		showEditor = true;
	}

	function handleSaveTool(tool: CustomTool): void {
		if (editingTool) {
			toolsState.updateCustomTool(tool.id, tool);
		} else {
			toolsState.addCustomTool(tool);
		}
		showEditor = false;
		editingTool = null;
	}

	function handleDeleteTool(tool: CustomTool): void {
		deleteConfirm = { show: true, tool };
	}

	function confirmDeleteTool(): void {
		if (deleteConfirm.tool) {
			toolsState.removeCustomTool(deleteConfirm.tool.id);
		}
		deleteConfirm = { show: false, tool: null };
	}

	const allTools = $derived(toolsState.getAllToolsWithState());
	const builtinTools = $derived(allTools.filter(t => t.isBuiltin));

	// Stats
	const stats = $derived({
		total: builtinTools.length + toolsState.customTools.length,
		enabled: builtinTools.filter(t => t.enabled).length + toolsState.customTools.filter(t => t.enabled).length,
		builtin: builtinTools.length,
		custom: toolsState.customTools.length
	});

	// Filtered tools based on search
	const filteredBuiltinTools = $derived(
		searchQuery.trim()
			? builtinTools.filter(t =>
				t.definition.function.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				t.definition.function.description.toLowerCase().includes(searchQuery.toLowerCase())
			)
			: builtinTools
	);

	const filteredCustomTools = $derived(
		searchQuery.trim()
			? toolsState.customTools.filter(t =>
				t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				t.description.toLowerCase().includes(searchQuery.toLowerCase())
			)
			: toolsState.customTools
	);

	function toggleTool(name: string): void {
		toolsState.toggleTool(name);
	}

	function toggleGlobalTools(): void {
		toolsState.toggleToolsEnabled();
	}

	function toggleDescription(toolName: string): void {
		const newSet = new Set(expandedDescriptions);
		if (newSet.has(toolName)) {
			newSet.delete(toolName);
		} else {
			newSet.add(toolName);
		}
		expandedDescriptions = newSet;
	}

	// Get icon for built-in tool based on name
	function getToolIcon(name: string): { icon: string; color: string } {
		const icons: Record<string, { icon: string; color: string }> = {
			'get_current_time': { icon: 'clock', color: 'text-amber-400' },
			'calculate': { icon: 'calculator', color: 'text-blue-400' },
			'fetch_url': { icon: 'globe', color: 'text-cyan-400' },
			'get_location': { icon: 'location', color: 'text-rose-400' },
			'web_search': { icon: 'search', color: 'text-emerald-400' }
		};
		return icons[name] || { icon: 'tool', color: 'text-gray-400' };
	}

	// Get implementation icon
	function getImplementationIcon(impl: string): { icon: string; color: string; bg: string } {
		const icons: Record<string, { icon: string; color: string; bg: string }> = {
			'javascript': { icon: 'js', color: 'text-yellow-300', bg: 'bg-yellow-900/30' },
			'python': { icon: 'py', color: 'text-blue-300', bg: 'bg-blue-900/30' },
			'http': { icon: 'http', color: 'text-purple-300', bg: 'bg-purple-900/30' }
		};
		return icons[impl] || { icon: '?', color: 'text-gray-300', bg: 'bg-gray-900/30' };
	}

	// Format parameters with type info
	function getParameters(def: ToolDefinition): Array<{ name: string; type: string; required: boolean; description?: string }> {
		const params = def.function.parameters;
		if (!params.properties) return [];

		return Object.entries(params.properties).map(([name, prop]) => ({
			name,
			type: prop.type,
			required: params.required?.includes(name) ?? false,
			description: prop.description
		}));
	}

	// Check if description is long
	function isLongDescription(text: string): boolean {
		return text.length > 150;
	}
</script>

<div>
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h2 class="text-xl font-bold text-theme-primary">Tools</h2>
			<p class="mt-1 text-sm text-theme-muted">
				Extend AI capabilities with built-in and custom tools
			</p>
		</div>

		<div class="flex items-center gap-3">
			<span class="text-sm text-theme-muted">Tools enabled</span>
			<button
				type="button"
				onclick={toggleGlobalTools}
				class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-theme-primary {toolsState.toolsEnabled ? 'bg-violet-600' : 'bg-theme-tertiary'}"
				role="switch"
				aria-checked={toolsState.toolsEnabled}
				aria-label="Toggle all tools"
			>
				<span class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {toolsState.toolsEnabled ? 'translate-x-5' : 'translate-x-0'}"></span>
			</button>
		</div>
	</div>

	<!-- Stats -->
	<div class="mb-6 grid grid-cols-4 gap-4">
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Total Tools</p>
			<p class="mt-1 text-2xl font-semibold text-theme-primary">{stats.total}</p>
		</div>
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Enabled</p>
			<p class="mt-1 text-2xl font-semibold text-emerald-400">{stats.enabled}</p>
		</div>
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Built-in</p>
			<p class="mt-1 text-2xl font-semibold text-blue-400">{stats.builtin}</p>
		</div>
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Custom</p>
			<p class="mt-1 text-2xl font-semibold text-violet-400">{stats.custom}</p>
		</div>
	</div>

	<!-- Search -->
	<div class="mb-6">
		<div class="relative">
			<svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search tools..."
				class="w-full rounded-lg border border-theme bg-theme-secondary py-2 pl-10 pr-4 text-sm text-theme-primary placeholder:text-theme-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
			/>
			{#if searchQuery}
				<button
					type="button"
					onclick={() => searchQuery = ''}
					class="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-primary"
					aria-label="Clear search"
				>
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- Built-in Tools -->
	<section class="mb-8">
		<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
			</svg>
			Built-in Tools
			<span class="text-sm font-normal text-theme-muted">({filteredBuiltinTools.length})</span>
		</h3>

		{#if filteredBuiltinTools.length === 0}
			<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
				<p class="text-sm text-theme-muted">No tools match your search</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each filteredBuiltinTools as tool (tool.definition.function.name)}
					{@const toolIcon = getToolIcon(tool.definition.function.name)}
					{@const params = getParameters(tool.definition)}
					{@const isLong = isLongDescription(tool.definition.function.description)}
					{@const isExpanded = expandedDescriptions.has(tool.definition.function.name)}
					<div class="rounded-lg border border-theme bg-theme-secondary transition-all {tool.enabled ? '' : 'opacity-50'}">
						<div class="p-4">
							<div class="flex items-start gap-4">
								<!-- Tool Icon -->
								<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-theme-tertiary {toolIcon.color}">
									{#if toolIcon.icon === 'clock'}
										<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
										</svg>
									{:else if toolIcon.icon === 'calculator'}
										<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V18zm2.498-6.75h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V13.5zm0 2.25h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V18zm2.504-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V18zm2.498-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM8.25 6h7.5v2.25h-7.5V6zM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0012 2.25z" />
										</svg>
									{:else if toolIcon.icon === 'globe'}
										<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
										</svg>
									{:else if toolIcon.icon === 'location'}
										<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
											<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
										</svg>
									{:else if toolIcon.icon === 'search'}
										<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
										</svg>
									{:else}
										<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
										</svg>
									{/if}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<h4 class="font-mono text-sm font-semibold text-theme-primary">{tool.definition.function.name}</h4>
										<span class="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-300">built-in</span>
									</div>

									<!-- Description -->
									<div class="mt-2">
										<p class="text-sm text-theme-muted {isLong && !isExpanded ? 'line-clamp-2' : ''}">
											{tool.definition.function.description}
										</p>
										{#if isLong}
											<button
												type="button"
												onclick={() => toggleDescription(tool.definition.function.name)}
												class="mt-1 text-xs text-violet-400 hover:text-violet-300"
											>
												{isExpanded ? 'Show less' : 'Show more'}
											</button>
										{/if}
									</div>
								</div>

								<!-- Toggle -->
								<button
									type="button"
									onclick={() => toggleTool(tool.definition.function.name)}
									class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-theme {tool.enabled ? 'bg-blue-600' : 'bg-theme-tertiary'}"
									role="switch"
									aria-checked={tool.enabled}
									aria-label="Toggle {tool.definition.function.name} tool"
									disabled={!toolsState.toolsEnabled}
								>
									<span class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {tool.enabled ? 'translate-x-5' : 'translate-x-0'}"></span>
								</button>
							</div>

							<!-- Parameters -->
							{#if params.length > 0}
								<div class="mt-3 flex flex-wrap gap-2 border-t border-theme pt-3">
									{#each params as param}
										<div class="flex items-center gap-1 rounded-md bg-theme-tertiary px-2 py-1" title={param.description || ''}>
											<span class="font-mono text-xs text-theme-primary">{param.name}</span>
											{#if param.required}
												<span class="text-xs text-rose-400">*</span>
											{/if}
											<span class="text-xs text-theme-muted">:</span>
											<span class="rounded bg-theme-hover px-1 text-xs text-cyan-400">{param.type}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Custom Tools -->
	<section>
		<div class="mb-4 flex items-center justify-between">
			<h3 class="flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
				</svg>
				Custom Tools
				<span class="text-sm font-normal text-theme-muted">({filteredCustomTools.length})</span>
			</h3>

			<button
				type="button"
				onclick={openCreateEditor}
				class="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				Create Tool
			</button>
		</div>

		{#if filteredCustomTools.length === 0 && toolsState.customTools.length === 0}
			<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
				</svg>
				<h4 class="mt-4 text-sm font-medium text-theme-secondary">No custom tools yet</h4>
				<p class="mt-1 text-sm text-theme-muted">Create JavaScript, Python, or HTTP tools to extend AI capabilities</p>
				<button
					type="button"
					onclick={openCreateEditor}
					class="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-500 px-4 py-2 text-sm font-medium text-violet-400 transition-colors hover:bg-violet-900/30"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Create Your First Tool
				</button>
			</div>
		{:else if filteredCustomTools.length === 0}
			<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
				<p class="text-sm text-theme-muted">No custom tools match your search</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each filteredCustomTools as tool (tool.id)}
					{@const implIcon = getImplementationIcon(tool.implementation)}
					{@const customParams = Object.entries(tool.parameters.properties ?? {})}
					{@const isLong = isLongDescription(tool.description)}
					{@const isExpanded = expandedDescriptions.has(tool.id)}
					<div class="rounded-lg border border-theme bg-theme-secondary transition-all {tool.enabled ? '' : 'opacity-50'}">
						<div class="p-4">
							<div class="flex items-start gap-4">
								<!-- Implementation Icon -->
								<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg {implIcon.bg}">
									{#if tool.implementation === 'javascript'}
										<span class="font-mono text-sm font-bold {implIcon.color}">JS</span>
									{:else if tool.implementation === 'python'}
										<span class="font-mono text-sm font-bold {implIcon.color}">PY</span>
									{:else}
										<svg class="h-5 w-5 {implIcon.color}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
										</svg>
									{/if}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<h4 class="font-mono text-sm font-semibold text-theme-primary">{tool.name}</h4>
										<span class="rounded-full bg-violet-900/40 px-2 py-0.5 text-xs font-medium text-violet-300">custom</span>
										<span class="rounded-full {implIcon.bg} px-2 py-0.5 text-xs font-medium {implIcon.color}">{tool.implementation}</span>
									</div>

									<!-- Description -->
									<div class="mt-2">
										<p class="text-sm text-theme-muted {isLong && !isExpanded ? 'line-clamp-2' : ''}">
											{tool.description}
										</p>
										{#if isLong}
											<button
												type="button"
												onclick={() => toggleDescription(tool.id)}
												class="mt-1 text-xs text-violet-400 hover:text-violet-300"
											>
												{isExpanded ? 'Show less' : 'Show more'}
											</button>
										{/if}
									</div>
								</div>

								<!-- Actions -->
								<div class="flex items-center gap-2">
									<button
										type="button"
										onclick={() => openEditEditor(tool)}
										class="rounded-lg p-2 text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary"
										aria-label="Edit tool"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
										</svg>
									</button>
									<button
										type="button"
										onclick={() => handleDeleteTool(tool)}
										class="rounded-lg p-2 text-theme-muted transition-colors hover:bg-red-900/30 hover:text-red-400"
										aria-label="Delete tool"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
										</svg>
									</button>
									<button
										type="button"
										onclick={() => toggleTool(tool.name)}
										class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-theme {tool.enabled ? 'bg-violet-600' : 'bg-theme-tertiary'}"
										role="switch"
										aria-checked={tool.enabled}
										aria-label="Toggle {tool.name} tool"
										disabled={!toolsState.toolsEnabled}
									>
										<span class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {tool.enabled ? 'translate-x-5' : 'translate-x-0'}"></span>
									</button>
								</div>
							</div>

							<!-- Parameters -->
							{#if customParams.length > 0}
								<div class="mt-3 flex flex-wrap gap-2 border-t border-theme pt-3">
									{#each customParams as [name, prop]}
										<div class="flex items-center gap-1 rounded-md bg-theme-tertiary px-2 py-1" title={prop.description || ''}>
											<span class="font-mono text-xs text-theme-primary">{name}</span>
											{#if tool.parameters.required?.includes(name)}
												<span class="text-xs text-rose-400">*</span>
											{/if}
											<span class="text-xs text-theme-muted">:</span>
											<span class="rounded bg-theme-hover px-1 text-xs text-cyan-400">{prop.type}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Info Section -->
	<section class="mt-8 rounded-lg border border-theme bg-gradient-to-br from-theme-secondary/80 to-theme-secondary/40 p-5">
		<h4 class="flex items-center gap-2 text-sm font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
			</svg>
			How Tools Work
		</h4>
		<p class="mt-3 text-sm text-theme-muted leading-relaxed">
			Tools extend the AI's capabilities by allowing it to perform actions beyond text generation.
			When you ask a question that could benefit from a tool, the AI will automatically select and use the appropriate one.
		</p>
		<div class="mt-4 grid gap-3 sm:grid-cols-3">
			<div class="rounded-lg bg-theme-tertiary/50 p-3">
				<div class="flex items-center gap-2 text-xs font-medium text-yellow-400">
					<span class="font-mono">JS</span>
					JavaScript
				</div>
				<p class="mt-1 text-xs text-theme-muted">Runs in browser, instant execution</p>
			</div>
			<div class="rounded-lg bg-theme-tertiary/50 p-3">
				<div class="flex items-center gap-2 text-xs font-medium text-blue-400">
					<span class="font-mono">PY</span>
					Python
				</div>
				<p class="mt-1 text-xs text-theme-muted">Runs on backend server</p>
			</div>
			<div class="rounded-lg bg-theme-tertiary/50 p-3">
				<div class="flex items-center gap-2 text-xs font-medium text-purple-400">
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
					</svg>
					HTTP
				</div>
				<p class="mt-1 text-xs text-theme-muted">Calls external APIs</p>
			</div>
		</div>
		<p class="mt-4 text-xs text-theme-muted">
			<strong class="text-theme-secondary">Note:</strong> Not all models support tool calling. Models like Llama 3.1+, Mistral 7B+, and Qwen have built-in tool support.
		</p>
	</section>
</div>

<ToolEditor
	isOpen={showEditor}
	editingTool={editingTool}
	onClose={() => { showEditor = false; editingTool = null; }}
	onSave={handleSaveTool}
/>

<ConfirmDialog
	isOpen={deleteConfirm.show}
	title="Delete Tool"
	message={`Delete "${deleteConfirm.tool?.name}"? This cannot be undone.`}
	confirmText="Delete"
	variant="danger"
	onConfirm={confirmDeleteTool}
	onCancel={() => (deleteConfirm = { show: false, tool: null })}
/>
