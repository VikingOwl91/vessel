<script lang="ts">
	/**
	 * ProjectModal - Create/Edit project with tabs for settings, instructions, and links
	 */
	import { projectsState, toastState } from '$lib/stores';
	import type { Project } from '$lib/stores/projects.svelte.js';
	import { addProjectLink, deleteProjectLink, getProjectLinks, type ProjectLink } from '$lib/storage/projects.js';
	import { ConfirmDialog } from '$lib/components/shared';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		projectId?: string | null;
		onUpdate?: () => void; // Called when project data changes (links added/deleted, etc.)
	}

	let { isOpen, onClose, projectId = null, onUpdate }: Props = $props();

	// Form state
	let name = $state('');
	let description = $state('');
	let instructions = $state('');
	let color = $state('#10b981');
	let links = $state<ProjectLink[]>([]);
	let newLinkUrl = $state('');
	let newLinkTitle = $state('');
	let newLinkDescription = $state('');
	let isLoading = $state(false);
	let activeTab = $state<'settings' | 'instructions' | 'links'>('settings');
	let showDeleteConfirm = $state(false);

	// Predefined colors for quick selection
	const presetColors = [
		'#10b981', // emerald
		'#3b82f6', // blue
		'#8b5cf6', // violet
		'#f59e0b', // amber
		'#ef4444', // red
		'#ec4899', // pink
		'#06b6d4', // cyan
		'#84cc16', // lime
	];

	// Get existing project data when editing
	const existingProject = $derived.by(() => {
		if (!projectId) return null;
		return projectsState.projects.find(p => p.id === projectId) || null;
	});

	// Modal title
	const modalTitle = $derived(projectId ? 'Edit Project' : 'Create Project');

	// Reset form when modal opens/closes or project changes
	$effect(() => {
		if (isOpen) {
			if (existingProject) {
				name = existingProject.name;
				description = existingProject.description || '';
				instructions = existingProject.instructions || '';
				color = existingProject.color || '#10b981';
				loadProjectLinks();
			} else {
				name = '';
				description = '';
				instructions = '';
				color = '#10b981';
				links = [];
			}
			activeTab = 'settings';
		}
	});

	async function loadProjectLinks() {
		if (!projectId) return;
		const result = await getProjectLinks(projectId);
		if (result.success) {
			links = result.data;
		}
	}

	async function handleSave() {
		if (!name.trim()) {
			toastState.error('Project name is required');
			return;
		}

		isLoading = true;

		try {
			if (projectId) {
				// Update existing project
				const success = await projectsState.update(projectId, {
					name: name.trim(),
					description: description.trim(),
					instructions: instructions.trim(),
					color
				});

				if (success) {
					toastState.success('Project updated');
					onClose();
				} else {
					toastState.error('Failed to update project');
				}
			} else {
				// Create new project
				const project = await projectsState.add({
					name: name.trim(),
					description: description.trim(),
					instructions: instructions.trim(),
					color
				});

				if (project) {
					toastState.success('Project created');
					onClose();
				} else {
					toastState.error('Failed to create project');
				}
			}
		} finally {
			isLoading = false;
		}
	}

	function handleDeleteClick() {
		if (!projectId) return;
		showDeleteConfirm = true;
	}

	async function handleDeleteConfirm() {
		if (!projectId) return;
		showDeleteConfirm = false;
		isLoading = true;

		try {
			const success = await projectsState.remove(projectId);
			if (success) {
				toastState.success('Project deleted');
				onClose();
			} else {
				toastState.error('Failed to delete project');
			}
		} finally {
			isLoading = false;
		}
	}

	async function handleAddLink() {
		if (!projectId || !newLinkUrl.trim()) {
			toastState.error('URL is required');
			return;
		}

		try {
			const result = await addProjectLink({
				projectId,
				url: newLinkUrl.trim(),
				title: newLinkTitle.trim() || newLinkUrl.trim(),
				description: newLinkDescription.trim()
			});

			if (result.success) {
				links = [...links, result.data];
				newLinkUrl = '';
				newLinkTitle = '';
				newLinkDescription = '';
				toastState.success('Link added');
				onUpdate?.(); // Notify parent to refresh
			} else {
				toastState.error('Failed to add link');
			}
		} catch {
			toastState.error('Failed to add link');
		}
	}

	async function handleDeleteLink(linkId: string) {
		try {
			const result = await deleteProjectLink(linkId);
			if (result.success) {
				links = links.filter(l => l.id !== linkId);
				toastState.success('Link removed');
				onUpdate?.(); // Notify parent to refresh
			} else {
				toastState.error('Failed to remove link');
			}
		} catch {
			toastState.error('Failed to remove link');
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="project-dialog-title"
		tabindex="-1"
	>
		<!-- Dialog -->
		<div class="mx-4 w-full max-w-lg rounded-xl border border-theme bg-theme-primary shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-theme px-6 py-4">
				<h2 id="project-dialog-title" class="text-lg font-semibold text-theme-primary">
					{modalTitle}
				</h2>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-1.5 text-theme-muted transition-colors hover:bg-theme-secondary hover:text-theme-primary"
					aria-label="Close dialog"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Tabs -->
			<div class="border-b border-theme px-6">
				<div class="flex gap-4">
					<button
						type="button"
						onclick={() => (activeTab = 'settings')}
						class="relative py-3 text-sm font-medium transition-colors {activeTab === 'settings' ? 'text-emerald-500' : 'text-theme-muted hover:text-theme-primary'}"
					>
						Settings
						{#if activeTab === 'settings'}
							<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
						{/if}
					</button>
					<button
						type="button"
						onclick={() => (activeTab = 'instructions')}
						class="relative py-3 text-sm font-medium transition-colors {activeTab === 'instructions' ? 'text-emerald-500' : 'text-theme-muted hover:text-theme-primary'}"
					>
						Instructions
						{#if activeTab === 'instructions'}
							<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
						{/if}
					</button>
					{#if projectId}
						<button
							type="button"
							onclick={() => (activeTab = 'links')}
							class="relative py-3 text-sm font-medium transition-colors {activeTab === 'links' ? 'text-emerald-500' : 'text-theme-muted hover:text-theme-primary'}"
						>
							Links ({links.length})
							{#if activeTab === 'links'}
								<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
							{/if}
						</button>
					{/if}
				</div>
			</div>

			<!-- Content -->
			<div class="max-h-[50vh] overflow-y-auto px-6 py-4">
				{#if activeTab === 'settings'}
					<!-- Settings Tab -->
					<div class="space-y-4">
						<!-- Name -->
						<div>
							<label for="project-name" class="mb-1.5 block text-sm font-medium text-theme-secondary">
								Name <span class="text-red-500">*</span>
							</label>
							<input
								id="project-name"
								type="text"
								bind:value={name}
								placeholder="My Project"
								class="w-full rounded-lg border border-theme bg-theme-tertiary px-3 py-2 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
							/>
						</div>

						<!-- Description -->
						<div>
							<label for="project-description" class="mb-1.5 block text-sm font-medium text-theme-secondary">
								Description
							</label>
							<input
								id="project-description"
								type="text"
								bind:value={description}
								placeholder="Optional description"
								class="w-full rounded-lg border border-theme bg-theme-tertiary px-3 py-2 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
							/>
						</div>

						<!-- Color -->
						<div>
							<span class="mb-1.5 block text-sm font-medium text-theme-secondary">
								Color
							</span>
							<div class="flex items-center gap-2">
								{#each presetColors as presetColor}
									<button
										type="button"
										onclick={() => (color = presetColor)}
										class="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 {color === presetColor ? 'border-white shadow-lg' : 'border-transparent'}"
										style="background-color: {presetColor}"
										aria-label="Select color {presetColor}"
									></button>
								{/each}
								<input
									type="color"
									bind:value={color}
									class="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
									title="Custom color"
								/>
							</div>
						</div>
					</div>
				{:else if activeTab === 'instructions'}
					<!-- Instructions Tab -->
					<div>
						<label for="project-instructions" class="mb-1.5 block text-sm font-medium text-theme-secondary">
							Project Instructions
						</label>
						<p class="mb-2 text-xs text-theme-muted">
							These instructions are injected into the system prompt for all chats in this project.
						</p>
						<textarea
							id="project-instructions"
							bind:value={instructions}
							rows="10"
							placeholder="You are helping with..."
							class="w-full rounded-lg border border-theme bg-theme-tertiary px-3 py-2 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
						></textarea>
					</div>
				{:else if activeTab === 'links'}
					<!-- Links Tab -->
					<div class="space-y-4">
						<!-- Add new link form -->
						<div class="rounded-lg border border-theme bg-theme-secondary/30 p-3">
							<h4 class="mb-2 text-sm font-medium text-theme-secondary">Add Reference Link</h4>
							<div class="space-y-2">
								<input
									type="url"
									bind:value={newLinkUrl}
									placeholder="https://..."
									class="w-full rounded border border-theme bg-theme-tertiary px-2 py-1.5 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none"
								/>
								<input
									type="text"
									bind:value={newLinkTitle}
									placeholder="Title (optional)"
									class="w-full rounded border border-theme bg-theme-tertiary px-2 py-1.5 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none"
								/>
								<input
									type="text"
									bind:value={newLinkDescription}
									placeholder="Description (optional)"
									class="w-full rounded border border-theme bg-theme-tertiary px-2 py-1.5 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none"
								/>
								<button
									type="button"
									onclick={handleAddLink}
									disabled={!newLinkUrl.trim()}
									class="w-full rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
								>
									Add Link
								</button>
							</div>
						</div>

						<!-- Existing links -->
						{#if links.length === 0}
							<p class="py-4 text-center text-sm text-theme-muted">No links added yet</p>
						{:else}
							<div class="space-y-2">
								{#each links as link (link.id)}
									<div class="flex items-start gap-2 rounded-lg border border-theme bg-theme-secondary/30 p-2">
										<div class="min-w-0 flex-1">
											<a
												href={link.url}
												target="_blank"
												rel="noopener noreferrer"
												class="block truncate text-sm font-medium text-emerald-500 hover:text-emerald-400"
											>
												{link.title}
											</a>
											{#if link.description}
												<p class="truncate text-xs text-theme-muted">{link.description}</p>
											{/if}
										</div>
										<button
											type="button"
											onclick={() => handleDeleteLink(link.id)}
											class="shrink-0 rounded p-1 text-theme-muted hover:bg-red-900/50 hover:text-red-400"
											aria-label="Remove link"
										>
											<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
											</svg>
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-theme px-6 py-4">
				<div>
					{#if projectId}
						<button
							type="button"
							onclick={handleDeleteClick}
							disabled={isLoading}
							class="rounded-lg px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-900/30 disabled:opacity-50"
						>
							Delete Project
						</button>
					{/if}
				</div>
				<div class="flex gap-3">
					<button
						type="button"
						onclick={onClose}
						class="rounded-lg px-4 py-2 text-sm font-medium text-theme-muted transition-colors hover:bg-theme-secondary hover:text-theme-primary"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={handleSave}
						disabled={isLoading || !name.trim()}
						class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
					>
						{isLoading ? 'Saving...' : projectId ? 'Save Changes' : 'Create Project'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	isOpen={showDeleteConfirm}
	title="Delete Project"
	message="Delete this project? Conversations will be unlinked but not deleted."
	confirmText="Delete"
	variant="danger"
	onConfirm={handleDeleteConfirm}
	onCancel={() => (showDeleteConfirm = false)}
/>
