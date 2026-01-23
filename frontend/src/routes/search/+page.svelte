<script lang="ts">
	/**
	 * Global Search Page
	 * Full-page search with tabs for titles, messages, and semantic search
	 */
	import { page } from '$app/stores';
	import { goto, replaceState } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { searchConversations, searchMessages, type MessageSearchResult } from '$lib/storage';
	import { conversationsState, settingsState } from '$lib/stores';
	import { searchChatHistory, type ChatSearchResult } from '$lib/services/chat-indexer.js';
	import type { Conversation } from '$lib/types/conversation';

	// Get query from URL
	let searchQuery = $state($page.url.searchParams.get('query') || '');
	let activeTab = $state<'titles' | 'messages' | 'semantic'>('semantic');
	let isSearching = $state(false);

	// Results
	let titleResults = $state<Conversation[]>([]);
	let messageResults = $state<MessageSearchResult[]>([]);
	let semanticResults = $state<ChatSearchResult[]>([]);

	// Debounce timer
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Input ref for autofocus
	let inputElement: HTMLInputElement;

	// Flag to prevent URL sync while actively typing/searching
	let isTyping = $state(false);
	let typingTimeout: ReturnType<typeof setTimeout> | null = null;

	// Update URL when query changes (using SvelteKit's replaceState)
	function updateUrl(query: string) {
		const url = new URL($page.url);
		if (query) {
			url.searchParams.set('query', query);
		} else {
			url.searchParams.delete('query');
		}
		replaceState(url, {});
	}

	// Mark as typing (to prevent URL sync from overwriting input)
	function markTyping() {
		isTyping = true;
		if (typingTimeout) clearTimeout(typingTimeout);
		// Stop considering as "typing" after 1 second of no input
		typingTimeout = setTimeout(() => {
			isTyping = false;
		}, 1000);
	}

	// Perform search with proper debouncing
	async function performSearch() {
		markTyping(); // Prevent URL sync from overwriting while typing

		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}

		const query = searchQuery.trim();

		if (!query) {
			titleResults = [];
			messageResults = [];
			semanticResults = [];
			isSearching = false;
			return;
		}

		// Debounce to avoid excessive API calls while typing
		debounceTimer = setTimeout(async () => {
			// Capture query at search time to avoid race conditions
			const currentQuery = searchQuery.trim();
			if (!currentQuery) return;

			isSearching = true;

			try {
				const [titlesResult, messagesResult, semanticSearchResults] = await Promise.all([
					searchConversations(currentQuery),
					searchMessages(currentQuery, { limit: 50 }),
					searchChatHistory(currentQuery, {
						topK: 50,
						threshold: 0.15,
						embeddingModel: settingsState.embeddingModel
					})
				]);

				// Only update results AND URL if query hasn't changed during search
				if (searchQuery.trim() === currentQuery) {
					if (titlesResult.success) {
						titleResults = titlesResult.data;
					}

					if (messagesResult.success) {
						messageResults = messagesResult.data;
					}

					semanticResults = semanticSearchResults;

					// Update URL only after successful search with unchanged query
					updateUrl(currentQuery);
				}
			} catch (error) {
				console.error('[Search] Search error:', error);
			} finally {
				isSearching = false;
			}
		}, 300);
	}

	// Navigate to conversation
	function navigateToConversation(conversationId: string) {
		goto(`/chat/${conversationId}`);
	}

	// Get conversation title for message results
	function getConversationTitle(conversationId: string): string {
		const conversation = conversationsState.find(conversationId);
		return conversation?.title ?? 'Unknown conversation';
	}

	// Get snippet around match
	function getSnippet(content: string, matchIndex: number, query: string): string {
		const start = Math.max(0, matchIndex - 40);
		const end = Math.min(content.length, matchIndex + query.length + 60);
		let snippet = content.slice(start, end);
		if (start > 0) snippet = '...' + snippet;
		if (end < content.length) snippet = snippet + '...';
		return snippet;
	}

	// Format date
	function formatDate(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));

		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return `${days} days ago`;

		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	// Run search on mount if query exists
	onMount(() => {
		if (searchQuery) {
			performSearch();
		}
		// Focus input
		inputElement?.focus();
	});

	// Watch for URL changes (back/forward navigation only)
	$effect(() => {
		const urlQuery = $page.url.searchParams.get('query') || '';
		// Only react to external URL changes when not actively typing
		untrack(() => {
			if (!isTyping && urlQuery !== searchQuery) {
				searchQuery = urlQuery;
				if (urlQuery) {
					performSearch();
				}
			}
		});
	});
</script>

<svelte:head>
	<title>{searchQuery ? `Search: ${searchQuery}` : 'Search'} - Vessel</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden bg-theme-primary">
	<!-- Search Header -->
	<div class="border-b border-theme px-6 py-4">
		<div class="mx-auto max-w-4xl">
			<!-- Search Input -->
			<div class="relative">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-theme-muted"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
					/>
				</svg>
				<input
					bind:this={inputElement}
					bind:value={searchQuery}
					oninput={performSearch}
					type="text"
					placeholder="Search conversations, messages, or use semantic search..."
					class="w-full rounded-xl border border-theme bg-slate-800 py-3 pl-12 pr-12 text-lg text-white placeholder-slate-400 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
				/>
				{#if isSearching}
					<svg class="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-theme-muted" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
					</svg>
				{:else if searchQuery}
					<button
						type="button"
						aria-label="Clear search"
						onclick={() => { searchQuery = ''; titleResults = []; messageResults = []; semanticResults = []; updateUrl(''); }}
						class="absolute right-4 top-1/2 -translate-y-1/2 rounded p-1 text-theme-muted hover:text-theme-primary"
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>

			<!-- Tabs -->
			<div class="mt-4 flex gap-2">
				<button
					type="button"
					onclick={() => (activeTab = 'semantic')}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {activeTab === 'semantic'
						? 'bg-emerald-600 text-white'
						: 'bg-theme-secondary text-theme-muted hover:text-theme-primary'}"
				>
					Semantic
					{#if semanticResults.length > 0}
						<span class="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{semanticResults.length}</span>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'titles')}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {activeTab === 'titles'
						? 'bg-violet-600 text-white'
						: 'bg-theme-secondary text-theme-muted hover:text-theme-primary'}"
				>
					Titles
					{#if titleResults.length > 0}
						<span class="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{titleResults.length}</span>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'messages')}
					class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {activeTab === 'messages'
						? 'bg-violet-600 text-white'
						: 'bg-theme-secondary text-theme-muted hover:text-theme-primary'}"
				>
					Messages
					{#if messageResults.length > 0}
						<span class="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{messageResults.length}</span>
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Results -->
	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-4xl px-6 py-6">
			{#if !searchQuery.trim()}
				<!-- Empty state -->
				<div class="flex flex-col items-center justify-center py-20 text-theme-muted">
					<svg class="mb-4 h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
						/>
					</svg>
					<p class="text-lg">Start typing to search...</p>
					<p class="mt-2 text-sm">Search across all your conversations using AI-powered semantic search</p>
				</div>
			{:else if activeTab === 'semantic'}
				{#if semanticResults.length === 0 && !isSearching}
					<div class="py-12 text-center text-theme-muted">
						<p>No semantic matches found for "{searchQuery}"</p>
						<p class="mt-2 text-sm">Semantic search uses AI embeddings to find similar content</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each semanticResults as result}
							<button
								type="button"
								onclick={() => navigateToConversation(result.conversationId)}
								class="block w-full rounded-xl border border-theme bg-theme-secondary p-4 text-left transition-colors hover:bg-theme-tertiary"
							>
								<div class="mb-2 flex items-center gap-2">
									<span class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
										{Math.round(result.similarity * 100)}% match
									</span>
									<span class="truncate text-sm text-theme-muted">
										{result.conversationTitle}
									</span>
								</div>
								<p class="line-clamp-3 text-sm text-theme-secondary">
									{result.content.slice(0, 300)}{result.content.length > 300 ? '...' : ''}
								</p>
							</button>
						{/each}
					</div>
				{/if}
			{:else if activeTab === 'titles'}
				{#if titleResults.length === 0 && !isSearching}
					<div class="py-12 text-center text-theme-muted">
						No conversations found matching "{searchQuery}"
					</div>
				{:else}
					<div class="space-y-2">
						{#each titleResults as result}
							<button
								type="button"
								onclick={() => navigateToConversation(result.id)}
								class="flex w-full items-center gap-4 rounded-xl border border-theme bg-theme-secondary p-4 text-left transition-colors hover:bg-theme-tertiary"
							>
								<svg class="h-5 w-5 flex-shrink-0 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
								</svg>
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium text-theme-primary">{result.title}</p>
									<p class="text-sm text-theme-muted">
										{result.messageCount} messages · {result.model}
									</p>
								</div>
								<span class="text-sm text-theme-muted">{formatDate(result.updatedAt)}</span>
								{#if result.isPinned}
									<svg class="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 24 24">
										<path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
									</svg>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			{:else if activeTab === 'messages'}
				{#if messageResults.length === 0 && !isSearching}
					<div class="py-12 text-center text-theme-muted">
						No messages found matching "{searchQuery}"
					</div>
				{:else}
					<div class="space-y-3">
						{#each messageResults as result}
							<button
								type="button"
								onclick={() => navigateToConversation(result.conversationId)}
								class="block w-full rounded-xl border border-theme bg-theme-secondary p-4 text-left transition-colors hover:bg-theme-tertiary"
							>
								<div class="mb-2 flex items-center gap-2">
									<span
										class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase {result.role === 'user'
											? 'bg-blue-500/20 text-blue-400'
											: 'bg-emerald-500/20 text-emerald-400'}"
									>
										{result.role}
									</span>
									<span class="truncate text-sm text-theme-muted">
										{getConversationTitle(result.conversationId)}
									</span>
								</div>
								<p class="line-clamp-2 text-sm text-theme-secondary">
									{getSnippet(result.content, result.matchIndex, searchQuery)}
								</p>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
