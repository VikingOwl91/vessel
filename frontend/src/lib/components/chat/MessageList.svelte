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

	// Track previous streaming state to detect when streaming ends
	// Note: Using plain variables (not $state) to avoid re-triggering effects
	let wasStreaming = false;

	// Threshold for "near bottom" detection
	const SCROLL_THRESHOLD = 100;

	/**
	 * Check if scroll position is near the bottom
	 */
	function isNearBottom(): boolean {
		if (!scrollContainer) return true;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
	}

	/**
	 * Handle scroll events - detect when user scrolls away
	 */
	function handleScroll(): void {
		if (!scrollContainer) return;

		// User is considered "scrolled away" if not near bottom
		userScrolledAway = !isNearBottom();
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

		// When streaming starts, scroll to bottom if user is near bottom
		if (isStreaming && !wasStreaming) {
			if (!userScrolledAway) {
				// Small delay to let the new message element render
				requestAnimationFrame(() => {
					scrollToBottomInstant();
				});
			}
		}

		// When streaming ends, do a final scroll if user hasn't scrolled away
		if (!isStreaming && wasStreaming) {
			if (!userScrolledAway) {
				requestAnimationFrame(() => {
					scrollToBottomInstant();
				});
			}
		}

		wasStreaming = isStreaming;
	});

	// Continuous scroll during streaming as content grows
	$effect(() => {
		// Track stream buffer changes - when content grows during streaming, scroll
		const buffer = chatState.streamBuffer;
		const isStreaming = chatState.isStreaming;

		if (isStreaming && buffer && !userScrolledAway) {
			requestAnimationFrame(() => {
				scrollToBottomInstant();
			});
		}
	});

	// Scroll when new messages are added (user sends a message)
	// Note: Using plain variable to avoid creating a dependency that re-triggers the effect
	let previousMessageCount = 0;
	$effect(() => {
		const currentCount = chatState.visibleMessages.length;

		if (currentCount > previousMessageCount && currentCount > 0) {
			// New message added - always scroll to it
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
			class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-700 px-4 py-2 text-sm text-slate-200 shadow-lg transition-all hover:bg-slate-600"
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
