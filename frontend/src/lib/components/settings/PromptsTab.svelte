<script lang="ts">
	/**
	 * PromptsTab - System prompts management
	 */
	import { promptsState, type Prompt } from '$lib/stores';
	import {
		getAllPromptTemplates,
		getPromptCategories,
		categoryInfo,
		type PromptTemplate,
		type PromptCategory
	} from '$lib/prompts/templates';
	import { ConfirmDialog } from '$lib/components/shared';

	type Tab = 'my-prompts' | 'browse-templates';
	let activeTab = $state<Tab>('my-prompts');
	let deleteConfirm = $state<{ show: boolean; prompt: Prompt | null }>({ show: false, prompt: null });

	let showEditor = $state(false);
	let editingPrompt = $state<Prompt | null>(null);

	let formName = $state('');
	let formDescription = $state('');
	let formContent = $state('');
	let formIsDefault = $state(false);
	let formTargetCapabilities = $state<string[]>([]);
	let isSaving = $state(false);

	let selectedCategory = $state<PromptCategory | 'all'>('all');
	let previewTemplate = $state<PromptTemplate | null>(null);
	let addingTemplateId = $state<string | null>(null);

	const templates = getAllPromptTemplates();
	const categories = getPromptCategories();

	const filteredTemplates = $derived(
		selectedCategory === 'all'
			? templates
			: templates.filter((t) => t.category === selectedCategory)
	);

	const CAPABILITIES = [
		{ id: 'code', label: 'Code', description: 'Auto-use with coding models' },
		{ id: 'vision', label: 'Vision', description: 'Auto-use with vision models' },
		{ id: 'thinking', label: 'Thinking', description: 'Auto-use with reasoning models' },
		{ id: 'tools', label: 'Tools', description: 'Auto-use with tool-capable models' }
	] as const;

	function openCreateEditor(): void {
		editingPrompt = null;
		formName = '';
		formDescription = '';
		formContent = '';
		formIsDefault = false;
		formTargetCapabilities = [];
		showEditor = true;
	}

	function openEditEditor(prompt: Prompt): void {
		editingPrompt = prompt;
		formName = prompt.name;
		formDescription = prompt.description;
		formContent = prompt.content;
		formIsDefault = prompt.isDefault;
		formTargetCapabilities = prompt.targetCapabilities ?? [];
		showEditor = true;
	}

	function closeEditor(): void {
		showEditor = false;
		editingPrompt = null;
	}

	async function handleSave(): Promise<void> {
		if (!formName.trim() || !formContent.trim()) return;

		isSaving = true;
		try {
			const capabilities = formTargetCapabilities.length > 0 ? formTargetCapabilities : undefined;
			if (editingPrompt) {
				await promptsState.update(editingPrompt.id, {
					name: formName.trim(),
					description: formDescription.trim(),
					content: formContent,
					isDefault: formIsDefault,
					targetCapabilities: capabilities ?? []
				});
			} else {
				await promptsState.add({
					name: formName.trim(),
					description: formDescription.trim(),
					content: formContent,
					isDefault: formIsDefault,
					targetCapabilities: capabilities
				});
			}
			closeEditor();
		} finally {
			isSaving = false;
		}
	}

	function toggleCapability(capId: string): void {
		if (formTargetCapabilities.includes(capId)) {
			formTargetCapabilities = formTargetCapabilities.filter((c) => c !== capId);
		} else {
			formTargetCapabilities = [...formTargetCapabilities, capId];
		}
	}

	function handleDeleteClick(prompt: Prompt): void {
		deleteConfirm = { show: true, prompt };
	}

	async function confirmDelete(): Promise<void> {
		if (!deleteConfirm.prompt) return;
		await promptsState.remove(deleteConfirm.prompt.id);
		deleteConfirm = { show: false, prompt: null };
	}

	async function handleSetDefault(prompt: Prompt): Promise<void> {
		if (prompt.isDefault) {
			await promptsState.clearDefault();
		} else {
			await promptsState.setDefault(prompt.id);
		}
	}

	function handleSetActive(prompt: Prompt): void {
		if (promptsState.activePromptId === prompt.id) {
			promptsState.setActive(null);
		} else {
			promptsState.setActive(prompt.id);
		}
	}

	async function addTemplateToLibrary(template: PromptTemplate): Promise<void> {
		addingTemplateId = template.id;
		try {
			await promptsState.add({
				name: template.name,
				description: template.description,
				content: template.content,
				isDefault: false,
				targetCapabilities: template.targetCapabilities
			});
			activeTab = 'my-prompts';
		} finally {
			addingTemplateId = null;
		}
	}

	function formatDate(date: Date): string {
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div>
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h2 class="text-xl font-bold text-theme-primary">System Prompts</h2>
			<p class="mt-1 text-sm text-theme-muted">
				Create and manage system prompt templates for conversations
			</p>
		</div>

		{#if activeTab === 'my-prompts'}
			<button
				type="button"
				onclick={openCreateEditor}
				class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-theme-primary transition-colors hover:bg-blue-700"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				Create Prompt
			</button>
		{/if}
	</div>

	<!-- Tabs -->
	<div class="mb-6 flex gap-1 rounded-lg bg-theme-tertiary p-1">
		<button
			type="button"
			onclick={() => (activeTab = 'my-prompts')}
			class="flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors {activeTab === 'my-prompts'
				? 'bg-theme-secondary text-theme-primary shadow'
				: 'text-theme-muted hover:text-theme-secondary'}"
		>
			My Prompts
			{#if promptsState.prompts.length > 0}
				<span class="ml-1.5 rounded-full bg-theme-tertiary px-2 py-0.5 text-xs {activeTab === 'my-prompts' ? 'bg-blue-500/20 text-blue-400' : ''}">
					{promptsState.prompts.length}
				</span>
			{/if}
		</button>
		<button
			type="button"
			onclick={() => (activeTab = 'browse-templates')}
			class="flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors {activeTab === 'browse-templates'
				? 'bg-theme-secondary text-theme-primary shadow'
				: 'text-theme-muted hover:text-theme-secondary'}"
		>
			Browse Templates
			<span class="ml-1.5 rounded-full bg-theme-tertiary px-2 py-0.5 text-xs {activeTab === 'browse-templates' ? 'bg-purple-500/20 text-purple-400' : ''}">
				{templates.length}
			</span>
		</button>
	</div>

	<!-- My Prompts Tab -->
	{#if activeTab === 'my-prompts'}
		{#if promptsState.activePrompt}
			<div class="mb-6 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
				<div class="flex items-center gap-2 text-sm text-blue-400">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span>Active system prompt: <strong class="text-blue-300">{promptsState.activePrompt.name}</strong></span>
				</div>
			</div>
		{/if}

		{#if promptsState.isLoading}
			<div class="flex items-center justify-center py-12">
				<div class="h-8 w-8 animate-spin rounded-full border-2 border-theme-subtle border-t-blue-500"></div>
			</div>
		{:else if promptsState.prompts.length === 0}
			<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
				</svg>
				<h3 class="mt-4 text-sm font-medium text-theme-muted">No system prompts yet</h3>
				<p class="mt-1 text-sm text-theme-muted">Create a prompt or browse templates to get started</p>
				<div class="mt-4 flex justify-center gap-3">
					<button type="button" onclick={openCreateEditor} class="inline-flex items-center gap-2 rounded-lg bg-theme-tertiary px-4 py-2 text-sm font-medium text-theme-primary hover:bg-theme-tertiary">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
						</svg>
						Create from scratch
					</button>
					<button type="button" onclick={() => (activeTab = 'browse-templates')} class="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-theme-primary hover:bg-purple-700">
						Browse templates
					</button>
				</div>
			</div>
		{:else}
			<div class="space-y-3">
				{#each promptsState.prompts as prompt (prompt.id)}
					<div class="rounded-lg border bg-theme-secondary p-4 transition-colors {promptsState.activePromptId === prompt.id ? 'border-blue-500/50' : 'border-theme'}">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="font-medium text-theme-primary">{prompt.name}</h3>
									{#if prompt.isDefault}
										<span class="rounded bg-blue-900 px-2 py-0.5 text-xs text-blue-300">default</span>
									{/if}
									{#if promptsState.activePromptId === prompt.id}
										<span class="rounded bg-emerald-900 px-2 py-0.5 text-xs text-emerald-300">active</span>
									{/if}
									{#if prompt.targetCapabilities && prompt.targetCapabilities.length > 0}
										{#each prompt.targetCapabilities as cap (cap)}
											<span class="rounded bg-purple-900/50 px-2 py-0.5 text-xs text-purple-300">{cap}</span>
										{/each}
									{/if}
								</div>
								{#if prompt.description}
									<p class="mt-1 text-sm text-theme-muted">{prompt.description}</p>
								{/if}
								<p class="mt-2 line-clamp-2 text-sm text-theme-muted">{prompt.content}</p>
								<p class="mt-2 text-xs text-theme-muted">Updated {formatDate(prompt.updatedAt)}</p>
							</div>

							<div class="flex items-center gap-2">
								<button type="button" onclick={() => handleSetActive(prompt)} class="rounded p-1.5 transition-colors {promptsState.activePromptId === prompt.id ? 'bg-emerald-600 text-theme-primary' : 'text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}" title={promptsState.activePromptId === prompt.id ? 'Deactivate' : 'Use for new chats'}>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
									</svg>
								</button>
								<button type="button" onclick={() => handleSetDefault(prompt)} class="rounded p-1.5 transition-colors {prompt.isDefault ? 'bg-blue-600 text-theme-primary' : 'text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary'}" title={prompt.isDefault ? 'Remove as default' : 'Set as default'}>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill={prompt.isDefault ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
									</svg>
								</button>
								<button type="button" onclick={() => openEditEditor(prompt)} class="rounded p-1.5 text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary" title="Edit">
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
									</svg>
								</button>
								<button type="button" onclick={() => handleDeleteClick(prompt)} class="rounded p-1.5 text-theme-muted hover:bg-red-900/30 hover:text-red-400" title="Delete">
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Browse Templates Tab -->
	{#if activeTab === 'browse-templates'}
		<div class="mb-6 flex flex-wrap gap-2">
			<button type="button" onclick={() => (selectedCategory = 'all')} class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {selectedCategory === 'all' ? 'bg-theme-secondary text-theme-primary' : 'bg-theme-tertiary text-theme-muted hover:text-theme-secondary'}">
				All
			</button>
			{#each categories as category (category)}
				{@const info = categoryInfo[category]}
				<button type="button" onclick={() => (selectedCategory = category)} class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {selectedCategory === category ? info.color : 'bg-theme-tertiary text-theme-muted hover:text-theme-secondary'}">
					<span>{info.icon}</span>
					{info.label}
				</button>
			{/each}
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			{#each filteredTemplates as template (template.id)}
				{@const info = categoryInfo[template.category]}
				<div class="rounded-lg border border-theme bg-theme-secondary p-4">
					<div class="mb-3 flex items-start justify-between gap-3">
						<div>
							<h3 class="font-medium text-theme-primary">{template.name}</h3>
							<span class="mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs {info.color}">
								<span>{info.icon}</span>
								{info.label}
							</span>
						</div>
						<button type="button" onclick={() => addTemplateToLibrary(template)} disabled={addingTemplateId === template.id} class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-theme-primary hover:bg-blue-700 disabled:opacity-50">
							{#if addingTemplateId === template.id}
								<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
								</svg>
							{/if}
							Add
						</button>
					</div>
					<p class="text-sm text-theme-muted">{template.description}</p>
					<button type="button" onclick={() => (previewTemplate = template)} class="mt-3 text-sm text-blue-400 hover:text-blue-300">
						Preview prompt
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Editor Modal -->
{#if showEditor}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={(e) => { if (e.target === e.currentTarget) closeEditor(); }} onkeydown={(e) => { if (e.key === 'Escape') closeEditor(); }} role="dialog" aria-modal="true" tabindex="-1">
		<div class="w-full max-w-2xl rounded-xl bg-theme-secondary shadow-xl">
			<div class="flex items-center justify-between border-b border-theme px-6 py-4">
				<h3 class="text-lg font-semibold text-theme-primary">{editingPrompt ? 'Edit Prompt' : 'Create Prompt'}</h3>
				<button type="button" onclick={closeEditor} aria-label="Close dialog" class="rounded p-1 text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<form onsubmit={(e) => { e.preventDefault(); handleSave(); }} class="p-6">
				<div class="space-y-4">
					<div>
						<label for="prompt-name" class="mb-1 block text-sm font-medium text-theme-secondary">Name <span class="text-red-400">*</span></label>
						<input id="prompt-name" type="text" bind:value={formName} placeholder="e.g., Code Reviewer" class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" required />
					</div>

					<div>
						<label for="prompt-description" class="mb-1 block text-sm font-medium text-theme-secondary">Description</label>
						<input id="prompt-description" type="text" bind:value={formDescription} placeholder="Brief description" class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
					</div>

					<div>
						<label for="prompt-content" class="mb-1 block text-sm font-medium text-theme-secondary">System Prompt <span class="text-red-400">*</span></label>
						<textarea id="prompt-content" bind:value={formContent} placeholder="You are a helpful assistant that..." rows="8" class="w-full resize-none rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 font-mono text-sm text-theme-primary placeholder-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" required></textarea>
						<p class="mt-1 text-xs text-theme-muted">{formContent.length} characters</p>
					</div>

					<div class="flex items-center gap-2">
						<input id="prompt-default" type="checkbox" bind:checked={formIsDefault} class="h-4 w-4 rounded border-theme-subtle bg-theme-tertiary text-blue-600 focus:ring-blue-500 focus:ring-offset-theme" />
						<label for="prompt-default" class="text-sm text-theme-secondary">Set as default for new chats</label>
					</div>

					<fieldset>
						<legend class="mb-2 block text-sm font-medium text-theme-secondary">Auto-use for model types</legend>
						<div class="flex flex-wrap gap-2">
							{#each CAPABILITIES as cap (cap.id)}
								<button type="button" onclick={() => toggleCapability(cap.id)} class="rounded-lg border px-3 py-1.5 text-sm transition-colors {formTargetCapabilities.includes(cap.id) ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-theme-subtle bg-theme-tertiary text-theme-muted hover:border-theme hover:text-theme-secondary'}" title={cap.description}>
									{cap.label}
								</button>
							{/each}
						</div>
					</fieldset>
				</div>

				<div class="mt-6 flex justify-end gap-3">
					<button type="button" onclick={closeEditor} class="rounded-lg px-4 py-2 text-sm font-medium text-theme-secondary hover:bg-theme-tertiary">Cancel</button>
					<button type="submit" disabled={isSaving || !formName.trim() || !formContent.trim()} class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-theme-primary hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
						{isSaving ? 'Saving...' : editingPrompt ? 'Update' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Template Preview Modal -->
{#if previewTemplate}
	{@const info = categoryInfo[previewTemplate.category]}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={(e) => { if (e.target === e.currentTarget) previewTemplate = null; }} onkeydown={(e) => { if (e.key === 'Escape') previewTemplate = null; }} role="dialog" aria-modal="true" tabindex="-1">
		<div class="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl bg-theme-secondary shadow-xl">
			<div class="flex items-center justify-between border-b border-theme px-6 py-4">
				<div>
					<h3 class="text-lg font-semibold text-theme-primary">{previewTemplate.name}</h3>
					<span class="mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs {info.color}">
						<span>{info.icon}</span>
						{info.label}
					</span>
				</div>
				<button type="button" onclick={() => (previewTemplate = null)} aria-label="Close dialog" class="rounded p-1 text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="flex-1 overflow-y-auto p-6">
				<p class="mb-4 text-sm text-theme-muted">{previewTemplate.description}</p>
				<pre class="whitespace-pre-wrap rounded-lg bg-theme-tertiary p-4 font-mono text-sm text-theme-primary">{previewTemplate.content}</pre>
			</div>
			<div class="flex justify-end gap-3 border-t border-theme px-6 py-4">
				<button type="button" onclick={() => (previewTemplate = null)} class="rounded-lg px-4 py-2 text-sm font-medium text-theme-secondary hover:bg-theme-tertiary">Close</button>
				<button type="button" onclick={() => { if (previewTemplate) { addTemplateToLibrary(previewTemplate); previewTemplate = null; } }} class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-theme-primary hover:bg-blue-700">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Add to Library
				</button>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	isOpen={deleteConfirm.show}
	title="Delete Prompt"
	message={`Delete "${deleteConfirm.prompt?.name}"? This cannot be undone.`}
	confirmText="Delete"
	variant="danger"
	onConfirm={confirmDelete}
	onCancel={() => (deleteConfirm = { show: false, prompt: null })}
/>
