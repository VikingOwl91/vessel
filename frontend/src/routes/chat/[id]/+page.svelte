<script lang="ts">
	/**
	 * Conversation view page
	 * Displays an existing conversation with chat window
	 */

	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/stores';
	import { chatState, conversationsState, modelsState } from '$lib/stores';
	import { getConversationFull } from '$lib/storage';
	import ChatWindow from '$lib/components/chat/ChatWindow.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Track current conversation ID for URL changes
	let currentConversationId = $state<string | null>(null);
	let isLoading = $state(false);

	// Extract first message from data (captured once per page load)
	const initialMessage = $derived(data.firstMessage);
	$effect(() => {
		// Clear firstMessage from URL to keep it clean
		if (initialMessage && $page.url.searchParams.has('firstMessage')) {
			const url = new URL($page.url);
			url.searchParams.delete('firstMessage');
			replaceState(url, {});
		}
	});

	/**
	 * Load conversation into chat state when URL changes
	 */
	$effect(() => {
		const { conversationId } = data;

		// Skip if same conversation
		if (conversationId === currentConversationId) {
			return;
		}

		currentConversationId = conversationId;

		// If this is a new conversation (just created from home page),
		// the chat state should already be set up
		if (chatState.conversationId === conversationId && chatState.visibleMessages.length > 0) {
			// Chat state is already set with messages, nothing to do
			return;
		}

		// Load conversation from IndexedDB
		loadConversation(conversationId);
	});

	/**
	 * Load full conversation from IndexedDB
	 */
	async function loadConversation(conversationId: string): Promise<void> {
		isLoading = true;

		const result = await getConversationFull(conversationId);

		if (!result.success || !result.data) {
			console.warn(`Conversation ${conversationId} not found, redirecting to home`);
			goto('/', { replaceState: true });
			isLoading = false;
			return;
		}

		const fullConversation = result.data;

		// Load into chat state
		chatState.load(
			conversationId,
			fullConversation.messages,
			fullConversation.rootMessageId,
			fullConversation.activePath
		);

		// Ensure conversation is in the store
		if (!conversationsState.find(conversationId)) {
			conversationsState.add({
				id: fullConversation.id,
				title: fullConversation.title,
				model: fullConversation.model,
				createdAt: fullConversation.createdAt,
				updatedAt: fullConversation.updatedAt,
				isPinned: fullConversation.isPinned,
				isArchived: fullConversation.isArchived,
				messageCount: fullConversation.messageCount
			});
		}

		isLoading = false;
	}

	/**
	 * Check if chat state has messages to display
	 */
	const hasMessages = $derived(chatState.visibleMessages.length > 0);

	/**
	 * Get conversation metadata for display
	 */
	const conversation = $derived(
		data.conversationId ? conversationsState.find(data.conversationId) : null
	);
</script>

<svelte:head>
	<title>{conversation?.title ?? 'Chat'} - Vessel</title>
</svelte:head>

<div class="flex h-full flex-col">
	{#if isLoading}
		<!-- Loading state -->
		<div class="flex h-full items-center justify-center">
			<div class="text-center">
				<div class="mb-4">
					<svg
						class="mx-auto h-12 w-12 animate-spin text-gray-400"
						fill="none"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
				</div>
				<p class="text-gray-600 dark:text-gray-400">Loading conversation...</p>
			</div>
		</div>
	{:else}
		<!-- Chat window in conversation mode -->
		<ChatWindow mode="conversation" {conversation} {initialMessage} />
	{/if}
</div>
