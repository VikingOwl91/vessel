<script lang="ts">
	/**
	 * ConversationList.svelte - Chat history list with projects and date groups
	 * Shows projects as folders at the top, then ungrouped conversations by date
	 */
	import { conversationsState, chatState, projectsState } from '$lib/stores';
	import ConversationItem from './ConversationItem.svelte';
	import ProjectFolder from './ProjectFolder.svelte';
	import type { Conversation } from '$lib/types/conversation.js';

	interface Props {
		onEditProject?: (projectId: string) => void;
	}

	let { onEditProject }: Props = $props();

	// State for showing archived conversations
	let showArchived = $state(false);

	// Derived: Conversations without a project, grouped by date
	const ungroupedConversations = $derived.by(() => {
		return conversationsState.withoutProject();
	});

	// Derived: Check if there are any project folders or ungrouped conversations
	const hasAnyContent = $derived.by(() => {
		return projectsState.projects.length > 0 || ungroupedConversations.length > 0;
	});

	// Derived: Map of project ID to conversations (cached to avoid repeated calls)
	const projectConversationsMap = $derived.by(() => {
		const map = new Map<string, Conversation[]>();
		for (const project of projectsState.projects) {
			map.set(project.id, conversationsState.forProject(project.id));
		}
		return map;
	});
</script>

<div class="flex flex-col px-2 py-1">
	{#if !hasAnyContent && conversationsState.grouped.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center px-4 py-8 text-center">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="mb-3 h-12 w-12 text-theme-muted"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
				/>
			</svg>
			{#if conversationsState.searchQuery}
				<p class="text-sm text-theme-muted">No conversations match your search</p>
				<button
					type="button"
					onclick={() => conversationsState.clearSearch()}
					class="mt-2 text-sm text-emerald-500 hover:text-emerald-400"
				>
					Clear search
				</button>
			{:else}
				<p class="text-sm text-theme-muted">No conversations yet</p>
				<p class="mt-1 text-xs text-theme-muted">Start a new chat to begin</p>
			{/if}
		</div>
	{:else}
		<!-- Projects section -->
		{#if projectsState.sortedProjects.length > 0}
			<div class="mb-3">
				<h3 class="sticky top-0 z-10 bg-theme-primary px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-theme-muted">
					Projects
				</h3>
				<div class="flex flex-col gap-0.5">
					{#each projectsState.sortedProjects as project (project.id)}
						<ProjectFolder
							{project}
							conversations={projectConversationsMap.get(project.id) ?? []}
							{onEditProject}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Ungrouped conversations (by date) -->
		{#each conversationsState.grouped as { group, conversations } (group)}
			{@const ungroupedInGroup = conversations.filter(c => !c.projectId)}
			{#if ungroupedInGroup.length > 0}
				<div class="mb-2">
					<!-- Group header -->
					<h3 class="sticky top-0 z-10 bg-theme-primary px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-theme-muted">
						{group}
					</h3>

					<!-- Conversations in this group (without project) -->
					<div class="flex flex-col gap-0.5">
						{#each ungroupedInGroup as conversation (conversation.id)}
							<ConversationItem
								{conversation}
								isSelected={chatState.conversationId === conversation.id}
							/>
						{/each}
					</div>
				</div>
			{/if}
		{/each}

		<!-- Archived section -->
		{#if conversationsState.archived.length > 0}
			<div class="mt-4 border-t border-theme/50 pt-2">
				<button
					type="button"
					onclick={() => (showArchived = !showArchived)}
					class="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-theme-muted hover:text-theme-muted"
				>
					<span>Archived ({conversationsState.archived.length})</span>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 transition-transform"
						class:rotate-180={showArchived}
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
					</svg>
				</button>

				{#if showArchived}
					<div class="mt-1 flex flex-col gap-0.5">
						{#each conversationsState.archived as conversation (conversation.id)}
							<ConversationItem
								{conversation}
								isSelected={chatState.conversationId === conversation.id}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
