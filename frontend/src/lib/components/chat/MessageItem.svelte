<script lang="ts">
	/**
	 * MessageItem - Single message display with avatar and actions
	 * Handles different styling for user vs assistant messages
	 */

	import type { MessageNode, BranchInfo } from '$lib/types';
	import MessageContent from './MessageContent.svelte';
	import MessageActions from './MessageActions.svelte';
	import BranchNavigator from './BranchNavigator.svelte';
	import StreamingIndicator from './StreamingIndicator.svelte';
	import ToolCallDisplay from './ToolCallDisplay.svelte';

	interface Props {
		node: MessageNode;
		branchInfo: BranchInfo | null;
		isStreaming?: boolean;
		isLast?: boolean;
		onBranchSwitch?: (direction: 'prev' | 'next') => void;
		onRegenerate?: () => void;
		onEdit?: (newContent: string) => void;
	}

	const {
		node,
		branchInfo,
		isStreaming = false,
		isLast = false,
		onBranchSwitch,
		onRegenerate,
		onEdit
	}: Props = $props();

	// State for edit mode
	let isEditing = $state(false);
	let editContent = $state('');

	const isUser = $derived(node.message.role === 'user');
	const isAssistant = $derived(node.message.role === 'assistant');
	const hasContent = $derived(node.message.content.length > 0);
	const hasToolCalls = $derived(node.message.toolCalls && node.message.toolCalls.length > 0);

	// Detect tool result messages (sent as user role but should be hidden or styled differently)
	const isToolResultMessage = $derived(
		isUser && (
			node.message.content.startsWith('Tool execution results:') ||
			node.message.content.startsWith('Tool result:') ||
			node.message.content.startsWith('Tool error:')
		)
	);

	/**
	 * Start editing a message
	 */
	function startEditing(): void {
		editContent = node.message.content;
		isEditing = true;
	}

	/**
	 * Cancel editing
	 */
	function cancelEditing(): void {
		isEditing = false;
		editContent = '';
	}

	/**
	 * Submit the edited message
	 */
	function submitEdit(): void {
		if (editContent.trim() && editContent !== node.message.content) {
			onEdit?.(editContent.trim());
		}
		isEditing = false;
		editContent = '';
	}

	/**
	 * Handle keyboard events in edit textarea
	 */
	function handleEditKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			cancelEditing();
		} else if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submitEdit();
		}
	}
</script>

<!-- Hide tool result messages - they're internal API messages -->
{#if isToolResultMessage}
	<!-- Tool results are handled in the assistant message display -->
{:else}
<article
	class="group mb-6 flex gap-4"
	class:justify-end={isUser}
	aria-label={isUser ? 'Your message' : 'Assistant message'}
>
	<!-- Avatar for assistant -->
	{#if isAssistant}
		<div
			class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white"
			aria-hidden="true"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="currentColor"
				class="h-5 w-5"
			>
				<path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zM7.5 13a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm9 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
			</svg>
		</div>
	{/if}

	<!-- Message content wrapper -->
	<div
		class="max-w-[80%] flex-1"
		class:max-w-[70%]={isUser}
	>
		<!-- Message bubble with branch navigator -->
		<div
			class="relative rounded-2xl px-4 py-3"
			class:bg-blue-500={isUser}
			class:text-white={isUser}
			class:bg-gray-100={isAssistant}
			class:dark:bg-gray-800={isAssistant}
			class:rounded-br-md={isUser}
			class:rounded-bl-md={isAssistant}
		>
			{#if isEditing}
				<!-- Edit mode -->
				<div class="space-y-2">
					<textarea
						bind:value={editContent}
						onkeydown={handleEditKeydown}
						class="w-full resize-none rounded-lg border border-gray-300 bg-white p-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
						rows="3"
						aria-label="Edit message"
					></textarea>
					<div class="flex justify-end gap-2">
						<button
							type="button"
							onclick={cancelEditing}
							class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={submitEdit}
							class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
						>
							Save & Submit
						</button>
					</div>
				</div>
			{:else}
				<!-- Normal display mode -->
				{#if hasContent}
					<MessageContent
						content={node.message.content}
						images={node.message.images}
					/>
				{/if}

				{#if hasToolCalls && node.message.toolCalls}
					<ToolCallDisplay toolCalls={node.message.toolCalls} />
				{/if}

				{#if isStreaming && !hasContent}
					<StreamingIndicator />
				{/if}

				{#if isStreaming && hasContent}
					<span class="inline-block h-4 w-0.5 animate-pulse bg-current align-text-bottom"></span>
				{/if}
			{/if}
		</div>

		<!-- Actions row - show on hover or for last message -->
		{#if !isEditing && !isStreaming}
			<div
				class="mt-1 flex items-center justify-between gap-2 opacity-0 transition-opacity group-hover:opacity-100"
				class:opacity-100={isLast}
				class:flex-row-reverse={isUser}
			>
				<!-- Branch navigator - positioned on left for assistant, right for user -->
				{#if branchInfo}
					<div class="flex-shrink-0">
						<BranchNavigator
							{branchInfo}
							onSwitch={onBranchSwitch}
						/>
					</div>
				{/if}

				<!-- Action buttons -->
				<MessageActions
					role={node.message.role}
					content={node.message.content}
					canRegenerate={isAssistant && isLast}
					onCopy={() => navigator.clipboard.writeText(node.message.content)}
					onEdit={isUser ? startEditing : undefined}
					{onRegenerate}
				/>
			</div>
		{/if}
	</div>

	<!-- Avatar for user -->
	{#if isUser}
		<div
			class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-white"
			aria-hidden="true"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="currentColor"
				class="h-5 w-5"
			>
				<path
					fill-rule="evenodd"
					d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z"
					clip-rule="evenodd"
				/>
			</svg>
		</div>
	{/if}
</article>
{/if}
