<script lang="ts">
	/**
	 * Tools management page
	 * Allows viewing, enabling/disabling, and creating custom tools
	 */

	import { toolsState } from '$lib/stores';
	import type { ToolDefinition, CustomTool } from '$lib/tools';
	import { ToolEditor } from '$lib/components/tools';

	// Editor state
	let showEditor = $state(false);
	let editingTool = $state<CustomTool | null>(null);

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
		if (confirm(`Delete "${tool.name}"? This cannot be undone.`)) {
			toolsState.removeCustomTool(tool.id);
		}
	}

	// Get all tools with their state
	const allTools = $derived(toolsState.getAllToolsWithState());

	// Group tools by type
	const builtinTools = $derived(allTools.filter(t => t.isBuiltin));

	/**
	 * Toggle tool enabled state
	 */
	function toggleTool(name: string): void {
		toolsState.toggleTool(name);
	}

	/**
	 * Toggle global tools enabled
	 */
	function toggleGlobalTools(): void {
		toolsState.toggleToolsEnabled();
	}

	/**
	 * Format parameter info for display
	 */
	function formatParameters(def: ToolDefinition): string {
		const params = def.function.parameters;
		if (!params.properties) return 'No parameters';

		const props = Object.entries(params.properties);
		if (props.length === 0) return 'No parameters';

		return props
			.map(([name, prop]) => {
				const required = params.required?.includes(name) ? '*' : '';
				return `${name}${required}: ${prop.type}`;
			})
			.join(', ');
	}
</script>

<div class="h-full overflow-y-auto bg-theme-primary p-6">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<div class="mb-8 flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold text-theme-primary">Tools</h1>
				<p class="mt-1 text-sm text-theme-muted">
					Manage tools available to the AI during conversations
				</p>
			</div>

			<!-- Global toggle -->
			<div class="flex items-center gap-3">
				<span class="text-sm text-theme-muted">Tools enabled</span>
				<button
					type="button"
					onclick={toggleGlobalTools}
					class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-theme-primary {toolsState.toolsEnabled ? 'bg-blue-600' : 'bg-theme-tertiary'}"
					role="switch"
					aria-checked={toolsState.toolsEnabled}
					aria-label="Toggle all tools"
				>
					<span
						class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {toolsState.toolsEnabled ? 'translate-x-5' : 'translate-x-0'}"
					></span>
				</button>
			</div>
		</div>

		<!-- Built-in Tools Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				Built-in Tools
			</h2>

			<div class="space-y-3">
				{#each builtinTools as tool (tool.definition.function.name)}
					<div
						class="rounded-lg border border-theme bg-theme-secondary p-4 transition-colors {tool.enabled ? '' : 'opacity-60'}"
					>
						<div class="flex items-start justify-between">
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<h3 class="font-medium text-theme-primary">
										{tool.definition.function.name}
									</h3>
									<span class="rounded bg-theme-tertiary px-2 py-0.5 text-xs text-theme-secondary">
										built-in
									</span>
								</div>
								<p class="mt-1 text-sm text-theme-muted">
									{tool.definition.function.description}
								</p>
								<p class="mt-2 font-mono text-xs text-theme-muted">
									Parameters: {formatParameters(tool.definition)}
								</p>
							</div>

							<button
								type="button"
								onclick={() => toggleTool(tool.definition.function.name)}
								class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-theme {tool.enabled ? 'bg-blue-600' : 'bg-theme-tertiary'}"
								role="switch"
								aria-checked={tool.enabled}
								aria-label="Toggle {tool.definition.function.name}"
								disabled={!toolsState.toolsEnabled}
							>
								<span
									class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {tool.enabled ? 'translate-x-5' : 'translate-x-0'}"
								></span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- Custom Tools Section -->
		<section>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="flex items-center gap-2 text-lg font-semibold text-theme-primary">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Custom Tools
				</h2>

				<button
					type="button"
					onclick={openCreateEditor}
					class="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-theme-primary transition-colors hover:bg-emerald-700"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Create Tool
				</button>
			</div>

			{#if toolsState.customTools.length === 0}
				<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
					<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
					</svg>
					<h3 class="mt-4 text-sm font-medium text-theme-muted">No custom tools yet</h3>
					<p class="mt-1 text-sm text-theme-muted">
						Create custom tools to extend AI capabilities
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each toolsState.customTools as tool (tool.id)}
						<div
							class="rounded-lg border border-theme bg-theme-secondary p-4 transition-colors {tool.enabled ? '' : 'opacity-60'}"
						>
							<div class="flex items-start justify-between">
								<div class="flex-1">
									<div class="flex items-center gap-2">
										<h3 class="font-medium text-theme-primary">
											{tool.name}
										</h3>
										<span class="rounded bg-emerald-900 px-2 py-0.5 text-xs text-emerald-300">
											custom
										</span>
										<span class="rounded bg-theme-tertiary px-2 py-0.5 text-xs text-theme-muted">
											{tool.implementation}
										</span>
									</div>
									<p class="mt-1 text-sm text-theme-muted">
										{tool.description}
									</p>
									{#if Object.keys(tool.parameters.properties ?? {}).length > 0}
										<p class="mt-1 font-mono text-xs text-theme-muted">
											Parameters: {Object.keys(tool.parameters.properties ?? {}).join(', ')}
										</p>
									{/if}
								</div>

								<div class="flex items-center gap-2">
									<button
										type="button"
										onclick={() => openEditEditor(tool)}
										class="rounded p-1 text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary"
										aria-label="Edit tool"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
										</svg>
									</button>

									<button
										type="button"
										onclick={() => handleDeleteTool(tool)}
										class="rounded p-1 text-theme-muted transition-colors hover:bg-red-900/30 hover:text-red-400"
										aria-label="Delete tool"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
									</button>

									<button
										type="button"
										onclick={() => toggleTool(tool.name)}
										class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-theme {tool.enabled ? 'bg-emerald-600' : 'bg-theme-tertiary'}"
										role="switch"
										aria-checked={tool.enabled}
										aria-label="Toggle {tool.name}"
										disabled={!toolsState.toolsEnabled}
									>
										<span
											class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {tool.enabled ? 'translate-x-5' : 'translate-x-0'}"
										></span>
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Info Section -->
		<section class="mt-8 rounded-lg border border-theme bg-theme-secondary/50 p-4">
			<h3 class="flex items-center gap-2 text-sm font-medium text-theme-secondary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				How Tools Work
			</h3>
			<p class="mt-2 text-sm text-theme-muted">
				Tools extend the AI's capabilities by allowing it to perform actions like calculations,
				fetching web content, or getting the current time. When you ask a question that could
				benefit from a tool, the AI will automatically use the appropriate tool and include
				the results in its response.
			</p>
			<p class="mt-2 text-sm text-theme-muted">
				<strong class="text-theme-secondary">Note:</strong> Not all models support tool calling.
				Models like Llama 3.1+ and Mistral 7B+ have built-in tool support.
			</p>
		</section>
	</div>
</div>

<!-- Tool Editor Modal -->
<ToolEditor
	isOpen={showEditor}
	editingTool={editingTool}
	onClose={() => { showEditor = false; editingTool = null; }}
	onSave={handleSaveTool}
/>
