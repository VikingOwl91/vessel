<script lang="ts">
	/**
	 * TopNav.svelte - Header bar for the Ollama chat UI
	 * Contains hamburger menu, model selector slot, and chat actions
	 */
	import type { Snippet } from 'svelte';
	import { uiState, chatState, conversationsState, toastState } from '$lib/stores';
	import { deleteConversation } from '$lib/storage';
	import ExportDialog from '$lib/components/shared/ExportDialog.svelte';
	import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
	import ContextUsageBar from '$lib/components/chat/ContextUsageBar.svelte';

	interface Props {
		/** Slot for the model select dropdown */
		modelSelect?: Snippet;
		/** Callback when navigation should happen (e.g., after delete) */
		onNavigateHome?: () => void;
	}

	let { modelSelect, onNavigateHome }: Props = $props();

	/** Check if we're currently in an active chat */
	let isInChat = $derived(chatState.conversationId !== null);

	/** Current conversation for actions */
	let currentConversation = $derived(
		chatState.conversationId ? conversationsState.find(chatState.conversationId) : null
	);

	/** Export dialog state */
	let exportDialogOpen = $state(false);

	/** Delete confirmation dialog state */
	let deleteDialogOpen = $state(false);

	/** Handle pin toggle */
	function handlePin() {
		if (chatState.conversationId) {
			const wasPinned = currentConversation?.isPinned;
			conversationsState.pin(chatState.conversationId);
			toastState.success(wasPinned ? 'Conversation unpinned' : 'Conversation pinned');
		}
	}

	/** Handle archive toggle */
	function handleArchive() {
		if (chatState.conversationId) {
			const wasArchived = currentConversation?.isArchived;
			conversationsState.archive(chatState.conversationId);
			toastState.success(wasArchived ? 'Conversation unarchived' : 'Conversation archived');

			// If archiving, navigate home
			if (!wasArchived && onNavigateHome) {
				chatState.reset();
				onNavigateHome();
			}
		}
	}

	/** Handle delete - opens confirmation dialog */
	function handleDeleteClick() {
		deleteDialogOpen = true;
	}

	/** Handle confirmed delete */
	async function handleDeleteConfirm() {
		if (chatState.conversationId) {
			const id = chatState.conversationId;
			// Delete from IndexedDB first
			const result = await deleteConversation(id);
			if (result.success) {
				conversationsState.remove(id);
				chatState.reset();
				toastState.success('Conversation deleted');
			} else {
				toastState.error('Failed to delete conversation');
			}
			deleteDialogOpen = false;

			// Navigate home
			if (onNavigateHome) {
				onNavigateHome();
			}
		}
	}

	/** Handle delete cancel */
	function handleDeleteCancel() {
		deleteDialogOpen = false;
	}

	/** Handle export button click - opens export dialog */
	function handleExport() {
		exportDialogOpen = true;
	}

	/** Handle export dialog close */
	function handleExportClose() {
		exportDialogOpen = false;
	}
</script>

<header
	class="flex h-16 items-center border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm"
>
	<div class="flex h-full w-full items-center justify-between px-4">
		<!-- Left section: Hamburger menu + Model select -->
		<div class="flex items-center gap-3">
			<!-- Hamburger menu button -->
			<button
				type="button"
				onclick={() => uiState.toggleSidenav()}
				class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
				aria-label={uiState.sidenavOpen ? 'Close sidebar' : 'Open sidebar'}
			>
				{#if uiState.sidenavOpen}
					<!-- Close/collapse icon -->
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
						/>
					</svg>
				{:else}
					<!-- Hamburger icon -->
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
						/>
					</svg>
				{/if}
			</button>

			<!-- Model select slot -->
			{#if modelSelect}
				{@render modelSelect()}
			{/if}
		</div>

		<!-- Center section: Chat title + context usage (only visible when in a chat) -->
		{#if isInChat}
			<div class="hidden flex-1 items-center justify-center gap-4 sm:flex">
				<!-- Conversation title -->
				{#if currentConversation}
					<h1 class="max-w-[300px] truncate text-sm font-medium text-slate-300" title={currentConversation.title}>
						{currentConversation.title}
					</h1>
				{/if}
				<ContextUsageBar compact />
			</div>
		{/if}

		<!-- Right section: Theme toggle + Chat actions -->
		<div class="flex items-center gap-1">
			<!-- Theme toggle (always visible) -->
			<button
				type="button"
				onclick={() => uiState.toggleDarkMode()}
				class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
				aria-label={uiState.darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
				title={uiState.darkMode ? 'Light mode' : 'Dark mode'}
			>
				{#if uiState.darkMode}
					<!-- Sun icon - shown in dark mode to switch to light -->
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
						/>
					</svg>
				{:else}
					<!-- Moon icon - shown in light mode to switch to dark -->
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
						/>
					</svg>
				{/if}
			</button>

		{#if isInChat}
				<!-- Export button -->
				<button
					type="button"
					onclick={handleExport}
					class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
					aria-label="Export conversation"
					title="Export"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
						/>
					</svg>
				</button>

				<!-- Pin button -->
				<button
					type="button"
					onclick={handlePin}
					class="rounded-lg p-2 transition-colors hover:bg-slate-800 {currentConversation?.isPinned ? 'text-emerald-500 hover:text-emerald-400' : 'text-slate-400 hover:text-slate-200'}"
					aria-label={currentConversation?.isPinned ? 'Unpin conversation' : 'Pin conversation'}
					title={currentConversation?.isPinned ? 'Unpin' : 'Pin'}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill={currentConversation?.isPinned ? 'currentColor' : 'none'}
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

				<!-- Archive button -->
				<button
					type="button"
					onclick={handleArchive}
					class="rounded-lg p-2 transition-colors hover:bg-slate-800 {currentConversation?.isArchived ? 'text-amber-500 hover:text-amber-400' : 'text-slate-400 hover:text-slate-200'}"
					aria-label={currentConversation?.isArchived ? 'Unarchive conversation' : 'Archive conversation'}
					title={currentConversation?.isArchived ? 'Unarchive' : 'Archive'}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
						/>
					</svg>
				</button>

				<!-- Delete button -->
				<button
					type="button"
					onclick={handleDeleteClick}
					class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-900/30 hover:text-red-400"
					aria-label="Delete conversation"
					title="Delete"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
						/>
					</svg>
				</button>
		{/if}
		</div>
	</div>
</header>

<!-- Export Dialog -->
<ExportDialog
	conversation={currentConversation}
	messageTree={chatState.messageTree}
	activePath={chatState.activePath}
	isOpen={exportDialogOpen}
	onClose={handleExportClose}
/>

<!-- Delete Confirmation Dialog -->
<ConfirmDialog
	isOpen={deleteDialogOpen}
	title="Delete Conversation"
	message="Are you sure you want to delete this conversation? This action cannot be undone."
	confirmText="Delete"
	cancelText="Cancel"
	variant="danger"
	onConfirm={handleDeleteConfirm}
	onCancel={handleDeleteCancel}
/>
