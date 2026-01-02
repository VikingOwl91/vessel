<script lang="ts">
	/**
	 * MessageList - Scrollable container for chat messages
	 * Uses CSS scroll anchoring for stable positioning during content changes
	 */

	import { chatState } from '$lib/stores';
	import type { MessageNode, BranchInfo } from '$lib/types';
	import MessageItem from './MessageItem.svelte';

	interface Props {
		onRegenerate?: () => void;
		onEditMessage?: (messageId: string, newContent: string) => void;
		/** Whether to show thinking blocks in messages */
		showThinking?: boolean;
	}

	const { onRegenerate, onEditMessage, showThinking = true }: Props = $props();

	// Reference to scroll container and anchor element
	let scrollContainer: HTMLDivElement | null = $state(null);
	let anchorElement: HTMLDivElement | null = $state(null);

	// Track if user has scrolled away from bottom
	let userScrolledAway = $state(false);

	// Track if auto-scroll is enabled for current streaming session
	// Disabled when message top reaches viewport top or user scrolls away
	let autoScrollEnabled = $state(true);

	// Track previous streaming state to detect when streaming ends
	// Note: Using plain variables (not $state) to avoid re-triggering effects
	let wasStreaming = false;

	// Threshold for "near bottom" detection
	const SCROLL_THRESHOLD = 100;

	// Buffer space at top of viewport before stopping auto-scroll
	const TOP_BUFFER = 20;

	/**
	 * Check if scroll position is near the bottom
	 */
	function isNearBottom(): boolean {
		if (!scrollContainer) return true;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
	}

	/**
	 * Check if the streaming message's top has reached the viewport top.
	 * This implements the "cloud provider" style auto-scroll behavior:
	 * scroll until the response is visible at the top, then stop.
	 */
	function hasMessageTopReachedViewportTop(): boolean {
		if (!scrollContainer) return false;

		// Find the last assistant message (the streaming message)
		const messages = scrollContainer.querySelectorAll('article');
		const lastMessage = messages[messages.length - 1];
		if (!lastMessage) return false;

		const containerRect = scrollContainer.getBoundingClientRect();
		const messageRect = lastMessage.getBoundingClientRect();

		// Message top has reached viewport top when it's at or above the container's top
		return messageRect.top <= containerRect.top + TOP_BUFFER;
	}

	/**
	 * Handle scroll events - detect when user scrolls away
	 */
	function handleScroll(): void {
		if (!scrollContainer) return;

		// User is considered "scrolled away" if not near bottom
		userScrolledAway = !isNearBottom();

		// If user manually scrolls away during streaming, disable auto-scroll
		if (userScrolledAway && chatState.isStreaming) {
			autoScrollEnabled = false;
		}
	}

	/**
	 * Scroll to bottom smoothly (for button click)
	 * Note: userScrolledAway is updated naturally by handleScroll when we reach bottom
	 */
	function scrollToBottom(): void {
		if (anchorElement) {
			anchorElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
		}
	}

	/**
	 * Scroll to bottom instantly (for auto-scroll)
	 * Note: userScrolledAway is updated naturally by handleScroll when we reach bottom
	 */
	function scrollToBottomInstant(): void {
		if (anchorElement) {
			anchorElement.scrollIntoView({ block: 'end' });
		}
	}

	// Auto-scroll when streaming state changes
	$effect(() => {
		const isStreaming = chatState.isStreaming;

		// When streaming starts, reset auto-scroll state and do initial scroll
		if (isStreaming && !wasStreaming) {
			autoScrollEnabled = true;
			if (!userScrolledAway) {
				// Small delay to let the new message element render
				requestAnimationFrame(() => {
					scrollToBottomInstant();
				});
			}
		}

		wasStreaming = isStreaming;
	});

	// Continuous scroll during streaming as content grows
	// Uses "cloud provider" style: scroll until message top reaches viewport top
	$effect(() => {
		// Track stream buffer changes - when content grows during streaming, scroll
		const buffer = chatState.streamBuffer;
		const isStreaming = chatState.isStreaming;

		if (isStreaming && buffer && autoScrollEnabled) {
			requestAnimationFrame(() => {
				// Check if the message top has reached the viewport top
				if (hasMessageTopReachedViewportTop()) {
					// Stop auto-scrolling - the user can now read from the beginning
					autoScrollEnabled = false;
				} else {
					// Continue scrolling to keep the message visible
					scrollToBottomInstant();
				}
			});
		}
	});

	// Scroll when new messages are added (user sends a message)
	// Note: Using plain variable to avoid creating a dependency that re-triggers the effect
	let previousMessageCount = 0;
	$effect(() => {
		const currentCount = chatState.visibleMessages.length;

		if (currentCount > previousMessageCount && currentCount > 0) {
			// New message added - reset scroll state and scroll to it
			autoScrollEnabled = true;
			userScrolledAway = false;
			requestAnimationFrame(() => {
				scrollToBottomInstant();
			});
		}

		previousMessageCount = currentCount;
	});

	// Show scroll button when user has scrolled away
	let showScrollButton = $derived(userScrolledAway && chatState.visibleMessages.length > 0);

	/**
	 * Get branch info for a message
	 */
	function getBranchInfo(node: MessageNode): BranchInfo | null {
		const info = chatState.getBranchInfo(node.id);
		// Only show branch navigator if there are multiple branches
		if (info && info.totalCount > 1) {
			return info;
		}
		return null;
	}

	/**
	 * Handle branch switch
	 */
	function handleBranchSwitch(messageId: string, direction: 'prev' | 'next'): void {
		chatState.switchBranch(messageId, direction);
	}

	/**
	 * Check if a message is currently streaming
	 */
	function isStreamingMessage(node: MessageNode): boolean {
		return chatState.isStreaming && chatState.streamingMessageId === node.id;
	}

	/**
	 * Check if this is the last message
	 */
	function isLastMessage(index: number): boolean {
		return index === chatState.visibleMessages.length - 1;
	}
</script>

<div class="relative h-full">
	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="h-full overflow-y-auto"
		style="overflow-anchor: none;"
		role="log"
		aria-live="polite"
		aria-label="Chat messages"
	>
		<div class="mx-auto max-w-4xl px-4 py-6">
			{#each chatState.visibleMessages as node, index (node.id)}
				<MessageItem
					{node}
					branchInfo={getBranchInfo(node)}
					isStreaming={isStreamingMessage(node)}
					isLast={isLastMessage(index)}
					{showThinking}
					onBranchSwitch={(direction) => handleBranchSwitch(node.id, direction)}
					onRegenerate={onRegenerate}
					onEdit={(newContent) => onEditMessage?.(node.id, newContent)}
				/>
			{/each}
			<!-- Scroll anchor element -->
			<div bind:this={anchorElement} class="h-0" aria-hidden="true"></div>
		</div>
	</div>

	<!-- Scroll to bottom button (shown when user scrolls away during streaming) -->
	{#if showScrollButton}
		<button
			type="button"
			onclick={scrollToBottom}
			class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-theme-tertiary px-4 py-2 text-sm text-theme-secondary shadow-lg transition-all hover:bg-theme-secondary"
			aria-label="Scroll to latest message"
		>
			<span class="flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M10 18a1 1 0 01-.707-.293l-5-5a1 1 0 011.414-1.414L10 15.586l4.293-4.293a1 1 0 011.414 1.414l-5 5A1 1 0 0110 18z" clip-rule="evenodd" />
				</svg>
				Jump to latest
			</span>
		</button>
	{/if}
</div>
