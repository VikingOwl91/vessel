<script lang="ts">
	/**
	 * SearchModal - Global search modal for conversations and messages
	 * Supports searching both conversation titles and message content
	 */
	import { goto } from '$app/navigation';
	import { searchConversations, searchMessages, type MessageSearchResult } from '$lib/storage';
	import { conversationsState } from '$lib/stores';
	import type { Conversation } from '$lib/types/conversation';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen, onClose }: Props = $props();

	// Search state
	let searchQuery = $state('');
	let activeTab = $state<'titles' | 'messages'>('titles');
	let isSearching = $state(false);

	// Results
	let titleResults = $state<Conversation[]>([]);
	let messageResults = $state<MessageSearchResult[]>([]);

	// Debounce timer
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Input element for focus
	let inputElement: HTMLInputElement | null = $state(null);

	/**
	 * Debounced search
	 */
	function handleSearch(): void {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		if (!searchQuery.trim()) {
			titleResults = [];
			messageResults = [];
			return;
		}

		debounceTimer = setTimeout(async () => {
			isSearching = true;

			try {
				// Search both in parallel
				const [titlesResult, messagesResult] = await Promise.all([
					searchConversations(searchQuery),
					searchMessages(searchQuery, { limit: 30 })
				]);

				if (titlesResult.success) {
					titleResults = titlesResult.data;
				}

				if (messagesResult.success) {
					messageResults = messagesResult.data;
				}
			} finally {
				isSearching = false;
			}
		}, 200);
	}

	/**
	 * Navigate to a conversation
	 */
	function navigateToConversation(conversationId: string): void {
		onClose();
		goto(`/chat/${conversationId}`);
	}

	/**
	 * Get a snippet around the match
	 */
	function getSnippet(content: string, matchIndex: number, query: string): string {
		const snippetLength = 100;
		const start = Math.max(0, matchIndex - 40);
		const end = Math.min(content.length, matchIndex + query.length + 60);

		let snippet = content.slice(start, end);

		// Add ellipsis if truncated
		if (start > 0) snippet = '...' + snippet;
		if (end < content.length) snippet = snippet + '...';

		return snippet;
	}

	/**
	 * Get conversation title for a message result
	 */
	function getConversationTitle(conversationId: string): string {
		const conversation = conversationsState.find(conversationId);
		return conversation?.title ?? 'Unknown conversation';
	}

	/**
	 * Handle backdrop click
	 */
	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	/**
	 * Handle keyboard events
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}

	/**
	 * Reset state and close
	 */
	function handleClose(): void {
		searchQuery = '';
		titleResults = [];
		messageResults = [];
		activeTab = 'titles';
		onClose();
	}

	// Focus input when modal opens
	$effect(() => {
		if (isOpen && inputElement) {
			setTimeout(() => inputElement?.focus(), 50);
		}
	});

	// Clear results when closing
	$effect(() => {
		if (!isOpen) {
			searchQuery = '';
			titleResults = [];
			messageResults = [];
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="search-dialog-title"
	>
		<!-- Dialog -->
		<div class="mx-4 w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
			<!-- Search input -->
			<div class="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 text-slate-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
					/>
				</svg>
				<input
					bind:this={inputElement}
					bind:value={searchQuery}
					oninput={handleSearch}
					type="text"
					placeholder="Search conversations and messages..."
					class="flex-1 bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none"
				/>
				{#if isSearching}
					<svg class="h-5 w-5 animate-spin text-slate-400" viewBox="0 0 24 24">
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
							fill="none"
						/>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						/>
					</svg>
				{:else if searchQuery}
					<button
						type="button"
						onclick={() => {
							searchQuery = '';
							titleResults = [];
							messageResults = [];
							inputElement?.focus();
						}}
						class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
						aria-label="Clear search"
					>
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				{/if}
				<kbd class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-500">Esc</kbd>
			</div>

			<!-- Tabs -->
			<div class="flex border-b border-slate-700">
				<button
					type="button"
					onclick={() => (activeTab = 'titles')}
					class="flex-1 px-4 py-2 text-sm font-medium transition-colors {activeTab === 'titles'
						? 'border-b-2 border-violet-500 text-violet-400'
						: 'text-slate-400 hover:text-slate-200'}"
				>
					Titles
					{#if titleResults.length > 0}
						<span class="ml-1.5 rounded-full bg-slate-800 px-1.5 py-0.5 text-xs"
							>{titleResults.length}</span
						>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'messages')}
					class="flex-1 px-4 py-2 text-sm font-medium transition-colors {activeTab === 'messages'
						? 'border-b-2 border-violet-500 text-violet-400'
						: 'text-slate-400 hover:text-slate-200'}"
				>
					Messages
					{#if messageResults.length > 0}
						<span class="ml-1.5 rounded-full bg-slate-800 px-1.5 py-0.5 text-xs"
							>{messageResults.length}</span
						>
					{/if}
				</button>
			</div>

			<!-- Results -->
			<div class="max-h-[50vh] overflow-y-auto">
				{#if !searchQuery.trim()}
					<!-- Empty state -->
					<div class="flex flex-col items-center justify-center py-12 text-slate-500">
						<svg class="mb-3 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
							/>
						</svg>
						<p class="text-sm">Start typing to search...</p>
					</div>
				{:else if activeTab === 'titles'}
					{#if titleResults.length === 0 && !isSearching}
						<div class="py-8 text-center text-sm text-slate-500">
							No conversations found matching "{searchQuery}"
						</div>
					{:else}
						<div class="divide-y divide-slate-800">
							{#each titleResults as result}
								<button
									type="button"
									onclick={() => navigateToConversation(result.id)}
									class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800"
								>
									<svg class="h-4 w-4 flex-shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
										/>
									</svg>
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium text-slate-200">
											{result.title}
										</p>
										<p class="text-xs text-slate-500">
											{result.messageCount} messages · {result.model}
										</p>
									</div>
									{#if result.isPinned}
										<svg class="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 24 24">
											<path
												d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
											/>
										</svg>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				{:else}
					{#if messageResults.length === 0 && !isSearching}
						<div class="py-8 text-center text-sm text-slate-500">
							No messages found matching "{searchQuery}"
						</div>
					{:else}
						<div class="divide-y divide-slate-800">
							{#each messageResults as result}
								<button
									type="button"
									onclick={() => navigateToConversation(result.conversationId)}
									class="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-slate-800"
								>
									<div class="flex items-center gap-2">
										<span
											class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase {result.role ===
											'user'
												? 'bg-blue-500/20 text-blue-400'
												: 'bg-emerald-500/20 text-emerald-400'}"
										>
											{result.role}
										</span>
										<span class="truncate text-xs text-slate-500">
											{getConversationTitle(result.conversationId)}
										</span>
									</div>
									<p class="line-clamp-2 text-sm text-slate-300">
										{getSnippet(result.content, result.matchIndex, searchQuery)}
									</p>
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer hint -->
			<div class="border-t border-slate-700 px-4 py-2">
				<p class="text-center text-xs text-slate-500">
					<kbd class="rounded bg-slate-800 px-1.5 py-0.5 font-mono">Enter</kbd> to select ·
					<kbd class="rounded bg-slate-800 px-1.5 py-0.5 font-mono">Tab</kbd> to switch tabs
				</p>
			</div>
		</div>
	</div>
{/if}
