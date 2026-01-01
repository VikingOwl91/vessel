<script lang="ts">
	/**
	 * ContextFullModal - Shown when context window is exhausted
	 * Offers recovery options: summarize, new chat, or dismiss
	 */

	import { contextManager } from '$lib/memory';
	import { formatTokenCount } from '$lib/memory/tokenizer';
	import { formatContextSize } from '$lib/memory/model-limits';

	interface Props {
		isOpen: boolean;
		onSummarize: () => void;
		onNewChat: () => void;
		onDismiss: () => void;
		isSummarizing?: boolean;
		canSummarize?: boolean;
	}

	const {
		isOpen,
		onSummarize,
		onNewChat,
		onDismiss,
		isSummarizing = false,
		canSummarize = true
	}: Props = $props();

	// Context usage info
	const usage = $derived(contextManager.contextUsage);
	const overflowAmount = $derived(Math.max(0, usage.usedTokens - usage.maxTokens));
</script>

{#if isOpen}
	<!-- Backdrop -->
	<div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
		<!-- Modal -->
		<div class="mx-4 w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 p-6 shadow-2xl">
			<!-- Header with warning icon -->
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
				</div>
				<div>
					<h2 class="text-lg font-semibold text-white">Context Window Full</h2>
					<p class="text-sm text-slate-400">
						{formatTokenCount(usage.usedTokens)} / {formatContextSize(usage.maxTokens)} tokens used
					</p>
				</div>
			</div>

			<!-- Explanation -->
			<div class="mb-6 rounded-lg bg-slate-800/50 p-4 text-sm text-slate-300">
				<p class="mb-2">
					The conversation has exceeded the model's context window by
					<span class="font-medium text-red-400">{formatTokenCount(overflowAmount)} tokens</span>.
				</p>
				<p class="text-slate-400">
					The model cannot process more text until space is freed. Choose how to proceed:
				</p>
			</div>

			<!-- Options -->
			<div class="space-y-3">
				<!-- Summarize option -->
				{#if canSummarize}
					<button
						type="button"
						onclick={onSummarize}
						disabled={isSummarizing}
						class="flex w-full items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500/20">
							{#if isSummarizing}
								<svg class="h-5 w-5 animate-spin text-emerald-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							{/if}
						</div>
						<div class="flex-1">
							<div class="font-medium text-emerald-300">
								{isSummarizing ? 'Summarizing...' : 'Summarize & Continue'}
							</div>
							<div class="text-xs text-slate-400">
								Compress older messages into a summary to free space
							</div>
						</div>
						<span class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
							Recommended
						</span>
					</button>
				{/if}

				<!-- New chat option -->
				<button
					type="button"
					onclick={onNewChat}
					class="flex w-full items-center gap-3 rounded-xl border border-slate-600/50 bg-slate-800/50 p-4 text-left transition-colors hover:bg-slate-700/50"
				>
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-700">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
						</svg>
					</div>
					<div class="flex-1">
						<div class="font-medium text-slate-200">Start New Chat</div>
						<div class="text-xs text-slate-400">
							Begin a fresh conversation (current chat is saved)
						</div>
					</div>
				</button>

				<!-- Dismiss option (risky) -->
				<button
					type="button"
					onclick={onDismiss}
					class="flex w-full items-center gap-3 rounded-xl border border-slate-700/50 p-4 text-left transition-colors hover:bg-slate-800/50"
				>
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</div>
					<div class="flex-1">
						<div class="font-medium text-slate-400">Continue Anyway</div>
						<div class="text-xs text-slate-500">
							Try to send (may result in errors or truncated responses)
						</div>
					</div>
				</button>
			</div>
		</div>
	</div>
{/if}
