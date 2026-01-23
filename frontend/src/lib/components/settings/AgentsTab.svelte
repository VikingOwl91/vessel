<script lang="ts">
	/**
	 * AgentsTab - Agent management settings tab
	 * CRUD operations for agents with prompt and tool configuration
	 */
	import { agentsState, promptsState, toolsState } from '$lib/stores';
	import type { Agent } from '$lib/storage';
	import { ConfirmDialog } from '$lib/components/shared';

	let showEditor = $state(false);
	let editingAgent = $state<Agent | null>(null);
	let searchQuery = $state('');
	let deleteConfirm = $state<{ show: boolean; agent: Agent | null }>({ show: false, agent: null });

	// Form state
	let formName = $state('');
	let formDescription = $state('');
	let formPromptId = $state<string | null>(null);
	let formPreferredModel = $state<string | null>(null);
	let formEnabledTools = $state<Set<string>>(new Set());

	// Stats
	const stats = $derived({
		total: agentsState.agents.length
	});

	// Filtered agents based on search
	const filteredAgents = $derived(
		searchQuery.trim()
			? agentsState.sortedAgents.filter(
					(a) =>
						a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
						a.description.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: agentsState.sortedAgents
	);

	// Available tools for selection
	const availableTools = $derived(
		toolsState.getAllToolsWithState().map((t) => ({
			name: t.definition.function.name,
			description: t.definition.function.description,
			isBuiltin: t.isBuiltin
		}))
	);

	function openCreateEditor(): void {
		editingAgent = null;
		formName = '';
		formDescription = '';
		formPromptId = null;
		formPreferredModel = null;
		formEnabledTools = new Set();
		showEditor = true;
	}

	function openEditEditor(agent: Agent): void {
		editingAgent = agent;
		formName = agent.name;
		formDescription = agent.description;
		formPromptId = agent.promptId;
		formPreferredModel = agent.preferredModel;
		formEnabledTools = new Set(agent.enabledToolNames);
		showEditor = true;
	}

	function closeEditor(): void {
		showEditor = false;
		editingAgent = null;
	}

	async function handleSave(): Promise<void> {
		if (!formName.trim()) return;

		const data = {
			name: formName.trim(),
			description: formDescription.trim(),
			promptId: formPromptId,
			preferredModel: formPreferredModel,
			enabledToolNames: Array.from(formEnabledTools)
		};

		if (editingAgent) {
			await agentsState.update(editingAgent.id, data);
		} else {
			await agentsState.add(data);
		}

		closeEditor();
	}

	function handleDelete(agent: Agent): void {
		deleteConfirm = { show: true, agent };
	}

	async function confirmDelete(): Promise<void> {
		if (deleteConfirm.agent) {
			await agentsState.remove(deleteConfirm.agent.id);
		}
		deleteConfirm = { show: false, agent: null };
	}

	function toggleTool(toolName: string): void {
		const newSet = new Set(formEnabledTools);
		if (newSet.has(toolName)) {
			newSet.delete(toolName);
		} else {
			newSet.add(toolName);
		}
		formEnabledTools = newSet;
	}

	function getPromptName(promptId: string | null): string {
		if (!promptId) return 'No prompt';
		const prompt = promptsState.get(promptId);
		return prompt?.name ?? 'Unknown prompt';
	}
</script>

<div>
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h2 class="text-xl font-bold text-theme-primary">Agents</h2>
			<p class="mt-1 text-sm text-theme-muted">
				Create specialized agents with custom prompts and tool sets
			</p>
		</div>

		<button
			type="button"
			onclick={openCreateEditor}
			class="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			Create Agent
		</button>
	</div>

	<!-- Stats -->
	<div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Total Agents</p>
			<p class="mt-1 text-2xl font-semibold text-theme-primary">{stats.total}</p>
		</div>
	</div>

	<!-- Search -->
	{#if agentsState.agents.length > 0}
		<div class="mb-6">
			<div class="relative">
				<svg
					class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted"
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
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search agents..."
					class="w-full rounded-lg border border-theme bg-theme-secondary py-2 pl-10 pr-4 text-sm text-theme-primary placeholder:text-theme-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={() => (searchQuery = '')}
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
	{/if}

	<!-- Agents List -->
	{#if filteredAgents.length === 0 && agentsState.agents.length === 0}
		<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
			<svg
				class="mx-auto h-12 w-12 text-theme-muted"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
				/>
			</svg>
			<h4 class="mt-4 text-sm font-medium text-theme-secondary">No agents yet</h4>
			<p class="mt-1 text-sm text-theme-muted">
				Create agents to combine prompts and tools for specialized tasks
			</p>
			<button
				type="button"
				onclick={openCreateEditor}
				class="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-500 px-4 py-2 text-sm font-medium text-violet-400 transition-colors hover:bg-violet-900/30"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				Create Your First Agent
			</button>
		</div>
	{:else if filteredAgents.length === 0}
		<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
			<p class="text-sm text-theme-muted">No agents match your search</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each filteredAgents as agent (agent.id)}
				<div class="rounded-lg border border-theme bg-theme-secondary">
					<div class="p-4">
						<div class="flex items-start gap-4">
							<!-- Agent Icon -->
							<div
								class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-900/30 text-violet-400"
							>
								<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
									/>
								</svg>
							</div>

							<!-- Content -->
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h4 class="font-semibold text-theme-primary">{agent.name}</h4>
									{#if agent.promptId}
										<span class="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-300">
											{getPromptName(agent.promptId)}
										</span>
									{/if}
									{#if agent.enabledToolNames.length > 0}
										<span
											class="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300"
										>
											{agent.enabledToolNames.length} tools
										</span>
									{/if}
								</div>

								{#if agent.description}
									<p class="mt-1 text-sm text-theme-muted line-clamp-2">
										{agent.description}
									</p>
								{/if}
							</div>

							<!-- Actions -->
							<div class="flex items-center gap-2">
								<button
									type="button"
									onclick={() => openEditEditor(agent)}
									class="rounded-lg p-2 text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary"
									aria-label="Edit agent"
								>
									<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
										/>
									</svg>
								</button>
								<button
									type="button"
									onclick={() => handleDelete(agent)}
									class="rounded-lg p-2 text-theme-muted transition-colors hover:bg-red-900/30 hover:text-red-400"
									aria-label="Delete agent"
								>
									<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
										/>
									</svg>
								</button>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Info Section -->
	<section class="mt-8 rounded-lg border border-theme bg-gradient-to-br from-theme-secondary/80 to-theme-secondary/40 p-5">
		<h4 class="flex items-center gap-2 text-sm font-semibold text-theme-primary">
			<svg class="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
				/>
			</svg>
			About Agents
		</h4>
		<p class="mt-3 text-sm leading-relaxed text-theme-muted">
			Agents combine a system prompt with a specific set of tools. When you select an agent for a
			chat, it will use the agent's prompt and only have access to the agent's allowed tools.
		</p>
		<div class="mt-4 grid gap-3 sm:grid-cols-2">
			<div class="rounded-lg bg-theme-tertiary/50 p-3">
				<div class="flex items-center gap-2 text-xs font-medium text-blue-400">
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
						/>
					</svg>
					System Prompt
				</div>
				<p class="mt-1 text-xs text-theme-muted">Defines the agent's personality and behavior</p>
			</div>
			<div class="rounded-lg bg-theme-tertiary/50 p-3">
				<div class="flex items-center gap-2 text-xs font-medium text-emerald-400">
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
						/>
					</svg>
					Tool Access
				</div>
				<p class="mt-1 text-xs text-theme-muted">Restricts which tools the agent can use</p>
			</div>
		</div>
	</section>
</div>

<!-- Editor Dialog -->
{#if showEditor}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="agent-editor-title"
	>
		<div class="w-full max-w-2xl rounded-xl border border-theme bg-theme-primary shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-theme px-6 py-4">
				<h3 id="agent-editor-title" class="text-lg font-semibold text-theme-primary">
					{editingAgent ? 'Edit Agent' : 'Create Agent'}
				</h3>
				<button
					type="button"
					onclick={closeEditor}
					class="rounded p-1 text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary"
					aria-label="Close"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Form -->
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
				class="max-h-[70vh] overflow-y-auto p-6"
			>
				<!-- Name -->
				<div class="mb-4">
					<label for="agent-name" class="mb-1 block text-sm font-medium text-theme-primary">
						Name <span class="text-red-400">*</span>
					</label>
					<input
						id="agent-name"
						type="text"
						bind:value={formName}
						placeholder="e.g., Research Assistant"
						required
						class="w-full rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary placeholder:text-theme-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
					/>
				</div>

				<!-- Description -->
				<div class="mb-4">
					<label for="agent-description" class="mb-1 block text-sm font-medium text-theme-primary">
						Description
					</label>
					<textarea
						id="agent-description"
						bind:value={formDescription}
						placeholder="Describe what this agent does..."
						rows={3}
						class="w-full rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary placeholder:text-theme-muted focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
					></textarea>
				</div>

				<!-- Prompt Selection -->
				<div class="mb-4">
					<label for="agent-prompt" class="mb-1 block text-sm font-medium text-theme-primary">
						System Prompt
					</label>
					<select
						id="agent-prompt"
						bind:value={formPromptId}
						class="w-full rounded-lg border border-theme bg-theme-secondary px-3 py-2 text-sm text-theme-primary focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
					>
						<option value={null}>No specific prompt (use defaults)</option>
						{#each promptsState.prompts as prompt (prompt.id)}
							<option value={prompt.id}>{prompt.name}</option>
						{/each}
					</select>
					<p class="mt-1 text-xs text-theme-muted">
						Select a prompt from your library to use with this agent
					</p>
				</div>

				<!-- Tools Selection -->
				<div class="mb-4">
					<span class="mb-2 block text-sm font-medium text-theme-primary"> Allowed Tools </span>
					<div class="max-h-48 overflow-y-auto rounded-lg border border-theme bg-theme-secondary p-2">
						{#if availableTools.length === 0}
							<p class="p-2 text-sm text-theme-muted">No tools available</p>
						{:else}
							<div class="space-y-1">
								{#each availableTools as tool (tool.name)}
									<label
										class="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-theme-tertiary"
									>
										<input
											type="checkbox"
											checked={formEnabledTools.has(tool.name)}
											onchange={() => toggleTool(tool.name)}
											class="h-4 w-4 rounded border-gray-600 bg-theme-tertiary text-violet-500 focus:ring-violet-500"
										/>
										<span class="text-sm text-theme-primary">{tool.name}</span>
										{#if tool.isBuiltin}
											<span class="text-xs text-blue-400">(built-in)</span>
										{/if}
									</label>
								{/each}
							</div>
						{/if}
					</div>
					<p class="mt-1 text-xs text-theme-muted">
						{formEnabledTools.size === 0
							? 'All tools will be available (no restrictions)'
							: `${formEnabledTools.size} tool(s) selected`}
					</p>
				</div>

				<!-- Actions -->
				<div class="mt-6 flex justify-end gap-3">
					<button
						type="button"
						onclick={closeEditor}
						class="rounded-lg border border-theme px-4 py-2 text-sm font-medium text-theme-secondary transition-colors hover:bg-theme-tertiary"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!formName.trim()}
						class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{editingAgent ? 'Save Changes' : 'Create Agent'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<ConfirmDialog
	isOpen={deleteConfirm.show}
	title="Delete Agent"
	message={`Delete "${deleteConfirm.agent?.name}"? This cannot be undone.`}
	confirmText="Delete"
	variant="danger"
	onConfirm={confirmDelete}
	onCancel={() => (deleteConfirm = { show: false, agent: null })}
/>
