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
		/** Whether to show thinking blocks in messages */
		showThinking?: boolean;
		onBranchSwitch?: (direction: 'prev' | 'next') => void;
		onRegenerate?: () => void;
		onEdit?: (newContent: string) => void;
	}

	const {
		node,
		branchInfo,
		isStreaming = false,
		isLast = false,
		showThinking = true,
		onBranchSwitch,
		onRegenerate,
		onEdit
	}: Props = $props();

	// State for edit mode
	let isEditing = $state(false);
	let editContent = $state('');

	const isUser = $derived(node.message.role === 'user');
	const isAssistant = $derived(node.message.role === 'assistant');
	const isSystem = $derived(node.message.role === 'system');
	const hasContent = $derived(node.message.content.length > 0);
	const hasToolCalls = $derived(node.message.toolCalls && node.message.toolCalls.length > 0);

	// Detect summary messages (compressed conversation history)
	const isSummaryMessage = $derived(node.message.isSummary === true);

	// Detect tool result messages (sent as user role but should be hidden or styled differently)
	const isToolResultMessage = $derived(
		isUser && (
			node.message.content.startsWith('Tool execution results:') ||
			node.message.content.startsWith('Tool result:') ||
			node.message.content.startsWith('Tool error:')
		)
	);

	// Detect tool-related assistant messages (has tool calls or contains tool results)
	const isToolMessage = $derived(
		isAssistant && (
			hasToolCalls ||
			node.message.content.includes('Tool result:') ||
			node.message.content.includes('Tool error:')
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
{:else if isSummaryMessage}
	<!-- Summary message - special compact styling -->
	<article
		class="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
		aria-label="Conversation summary"
	>
		<div class="flex items-start gap-3">
			<!-- Archive/compress icon -->
			<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
					<path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z" />
				</svg>
			</div>
			<div class="min-w-0 flex-1">
				<div class="mb-1 flex items-center gap-2">
					<span class="text-xs font-medium text-amber-400">Conversation Summary</span>
					<span class="text-xs text-slate-500">Earlier messages compressed</span>
				</div>
				<div class="prose prose-sm prose-invert max-w-none text-slate-300">
					<MessageContent
						content={node.message.content.replace('[Previous conversation summary]\n\n', '')}
						{isStreaming}
						{showThinking}
					/>
				</div>
			</div>
		</div>
	</article>
{:else}
<article
	class="group mb-6 flex gap-4"
	class:justify-end={isUser}
	aria-label={isUser ? 'Your message' : 'Assistant message'}
>
	<!-- Avatar for assistant -->
	{#if isAssistant}
		{#if isToolMessage}
			<!-- Tool message avatar - subtle teal -->
			<div
				class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500"
				aria-hidden="true"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path fill-rule="evenodd" d="M12 6.75a5.25 5.25 0 016.775-5.025.75.75 0 01.313 1.248l-3.32 3.319c.063.475.276.934.641 1.299.365.365.824.578 1.3.64l3.318-3.319a.75.75 0 011.248.313 5.25 5.25 0 01-5.472 6.756c-1.018-.086-1.87.1-2.309.634L7.344 21.3A3.298 3.298 0 112.7 16.657l8.684-7.151c.533-.44.72-1.291.634-2.309A5.342 5.342 0 0112 6.75zM4.117 19.125a.75.75 0 01.75-.75h.008a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75h-.008a.75.75 0 01-.75-.75v-.008z" clip-rule="evenodd" />
				</svg>
			</div>
		{:else}
			<!-- Normal assistant avatar - subtle violet -->
			<div
				class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500"
				aria-hidden="true"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
				</svg>
			</div>
		{/if}
	{/if}

	<!-- Message content wrapper -->
	<div
		class="max-w-[80%] flex-1"
		class:max-w-[70%]={isUser}
	>
		<!-- Message bubble with branch navigator -->
		<div
			class="relative rounded-2xl px-4 py-3 {isUser
				? 'bg-slate-700 text-slate-100'
				: isToolMessage
					? 'bg-slate-800/50 border-l-2 border-teal-500/50'
					: 'bg-transparent'}"
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
						{isStreaming}
						{showThinking}
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
			class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-600 text-slate-300"
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
