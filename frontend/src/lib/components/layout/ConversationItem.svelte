<script lang="ts">
	/**
	 * ConversationItem.svelte - Single conversation row in the sidebar
	 * Shows title, model, and hover actions (pin, move, export, delete)
	 */
	import type { Conversation } from '$lib/types/conversation.js';
	import { goto } from '$app/navigation';
	import { conversationsState, uiState, chatState, toastState } from '$lib/stores';
	import { deleteConversation } from '$lib/storage';
	import { ExportDialog } from '$lib/components/shared';
	import MoveToProjectModal from '$lib/components/projects/MoveToProjectModal.svelte';

	interface Props {
		conversation: Conversation;
		isSelected?: boolean;
	}

	let { conversation, isSelected = false }: Props = $props();

	// Export dialog state
	let showExportDialog = $state(false);

	// Move to project dialog state
	let showMoveDialog = $state(false);

	/** Format relative time for display */
	function formatRelativeTime(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	/** Handle pin toggle */
	function handlePin(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		conversationsState.pin(conversation.id);
	}

	/** Handle export */
	function handleExport(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		showExportDialog = true;
	}

	/** Handle move to project */
	function handleMove(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		showMoveDialog = true;
	}

	/** Handle delete */
	async function handleDelete(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		const isCurrentChat = chatState.conversationId === conversation.id;

		// Delete from IndexedDB first
		const result = await deleteConversation(conversation.id);
		if (result.success) {
			// Then remove from state
			conversationsState.remove(conversation.id);

			// If deleting the active chat, navigate home
			if (isCurrentChat) {
				chatState.reset();
				goto('/');
			}
		} else {
			toastState.error('Failed to delete conversation');
		}
	}

	/** Handle click - close sidenav on mobile */
	function handleClick() {
		if (uiState.isMobile) {
			uiState.closeSidenav();
		}
	}
</script>

<a
	href="/chat/{conversation.id}"
	onclick={handleClick}
	class="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors {isSelected ? 'bg-theme-secondary' : 'hover:bg-theme-secondary/60'}"
>
	<!-- Chat icon -->
	<div class="mt-0.5 shrink-0">
		{#if conversation.isPinned}
			<!-- Bookmark icon for pinned conversations -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4 text-emerald-500"
				viewBox="0 0 24 24"
				fill="currentColor"
			>
				<path
					fill-rule="evenodd"
					d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z"
					clip-rule="evenodd"
				/>
			</svg>
		{:else}
			<!-- Regular chat bubble -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4 text-theme-muted"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
				/>
			</svg>
		{/if}
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1">
		<!-- Title -->
		<p
			class="truncate text-sm font-medium"
			class:text-theme-primary={isSelected}
			class:text-theme-secondary={!isSelected}
			title={conversation.title || 'New Conversation'}
		>
			{conversation.title || 'New Conversation'}
		</p>

		<!-- Meta info (model + time) -->
		<div class="mt-0.5 flex items-center gap-2 text-xs text-theme-muted">
			<span class="truncate">{conversation.model}</span>
			<span class="shrink-0">-</span>
			<span class="shrink-0">{formatRelativeTime(conversation.updatedAt)}</span>
		</div>
	</div>

	<!-- Action buttons (always visible on mobile, hover on desktop) -->
	<div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 transition-opacity {uiState.isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
		<!-- Pin/Unpin button -->
		<button
			type="button"
			onclick={handlePin}
			class="rounded p-1 transition-colors hover:bg-theme-tertiary {conversation.isPinned ? 'text-emerald-500 hover:text-emerald-400' : 'text-theme-muted hover:text-theme-primary'}"
			aria-label={conversation.isPinned ? 'Unpin conversation' : 'Pin conversation'}
			title={conversation.isPinned ? 'Unpin' : 'Pin'}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill={conversation.isPinned ? 'currentColor' : 'none'}
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
				/>
			</svg>
		</button>

		<!-- Move to project button -->
		<button
			type="button"
			onclick={handleMove}
			class="rounded p-1 text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary"
			aria-label="Move to project"
			title="Move to project"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
				/>
			</svg>
		</button>

		<!-- Export button -->
		<button
			type="button"
			onclick={handleExport}
			class="rounded p-1 text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-primary"
			aria-label="Export conversation"
			title="Export"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
				/>
			</svg>
		</button>

		<!-- Delete button -->
		<button
			type="button"
			onclick={handleDelete}
			class="rounded p-1 text-theme-muted transition-colors hover:bg-red-900/50 hover:text-red-400"
			aria-label="Delete conversation"
			title="Delete"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
				/>
			</svg>
		</button>
	</div>
</a>

<!-- Export Dialog -->
<ExportDialog
	conversationId={conversation.id}
	isOpen={showExportDialog}
	onClose={() => (showExportDialog = false)}
/>

<!-- Move to Project Modal -->
<MoveToProjectModal
	conversationId={conversation.id}
	isOpen={showMoveDialog}
	onClose={() => (showMoveDialog = false)}
/>
