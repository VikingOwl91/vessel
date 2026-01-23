<script lang="ts">
	/**
	 * MoveToProjectModal - Move a conversation to a different project
	 */
	import { projectsState, conversationsState, toastState } from '$lib/stores';
	import { moveConversationToProject } from '$lib/storage/conversations.js';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		conversationId: string;
	}

	let { isOpen, onClose, conversationId }: Props = $props();

	let isLoading = $state(false);

	// Get current conversation's project
	const currentConversation = $derived.by(() => {
		return conversationsState.find(conversationId);
	});

	const currentProjectId = $derived(currentConversation?.projectId || null);

	async function handleSelect(projectId: string | null) {
		if (projectId === currentProjectId) {
			onClose();
			return;
		}

		isLoading = true;

		try {
			const result = await moveConversationToProject(conversationId, projectId);
			if (result.success) {
				// Update local state
				conversationsState.moveToProject(conversationId, projectId);

				const projectName = projectId
					? projectsState.projects.find(p => p.id === projectId)?.name || 'project'
					: 'No Project';
				toastState.success(`Moved to ${projectName}`);
				onClose();
			} else {
				toastState.error('Failed to move conversation');
			}
		} catch {
			toastState.error('Failed to move conversation');
		} finally {
			isLoading = false;
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
		aria-labelledby="move-dialog-title"
		tabindex="-1"
	>
		<!-- Dialog -->
		<div class="mx-4 w-full max-w-sm rounded-xl border border-theme bg-theme-primary shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-theme px-6 py-4">
				<h2 id="move-dialog-title" class="text-lg font-semibold text-theme-primary">
					Move to Project
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

			<!-- Content -->
			<div class="max-h-[50vh] overflow-y-auto px-2 py-3">
				{#if isLoading}
					<div class="flex items-center justify-center py-8">
						<div class="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></div>
					</div>
				{:else}
					<!-- No Project option -->
					<button
						type="button"
						onclick={() => handleSelect(null)}
						class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-theme-secondary {currentProjectId === null ? 'bg-theme-secondary' : ''}"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5 text-theme-muted"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
							/>
						</svg>
						<span class="text-sm text-theme-secondary">No Project</span>
						{#if currentProjectId === null}
							<svg xmlns="http://www.w3.org/2000/svg" class="ml-auto h-5 w-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
							</svg>
						{/if}
					</button>

					<!-- Project options -->
					{#if projectsState.sortedProjects.length > 0}
						<div class="my-2 border-t border-theme"></div>
						{#each projectsState.sortedProjects as project (project.id)}
							<button
								type="button"
								onclick={() => handleSelect(project.id)}
								class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-theme-secondary {currentProjectId === project.id ? 'bg-theme-secondary' : ''}"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5 shrink-0"
									viewBox="0 0 20 20"
									fill={project.color || '#10b981'}
								>
									<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
								</svg>
								<span class="truncate text-sm text-theme-secondary">{project.name}</span>
								{#if currentProjectId === project.id}
									<svg xmlns="http://www.w3.org/2000/svg" class="ml-auto h-5 w-5 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
									</svg>
								{/if}
							</button>
						{/each}
					{/if}

					<!-- Empty state -->
					{#if projectsState.sortedProjects.length === 0}
						<p class="px-4 py-6 text-center text-sm text-theme-muted">
							No projects yet. Create one from the sidebar.
						</p>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
