<script lang="ts">
	/**
	 * SystemPromptSelector - Dropdown to select a system prompt for the current conversation
	 * Allows per-conversation prompt assignment with quick preview
	 */
	import { promptsState, conversationsState, toastState } from '$lib/stores';
	import { updateSystemPrompt } from '$lib/storage';

	interface Props {
		conversationId: string | null;
		currentPromptId?: string | null;
	}

	let { conversationId, currentPromptId = null }: Props = $props();

	// UI state
	let isOpen = $state(false);
	let dropdownElement: HTMLDivElement | null = $state(null);

	// Available prompts from store
	const prompts = $derived(promptsState.prompts);

	// Current prompt for this conversation
	const currentPrompt = $derived(
		currentPromptId ? prompts.find((p) => p.id === currentPromptId) : null
	);

	// Display text for the button
	const buttonText = $derived(currentPrompt?.name ?? 'No system prompt');

	/**
	 * Toggle dropdown
	 */
	function toggleDropdown(): void {
		isOpen = !isOpen;
	}

	/**
	 * Close dropdown
	 */
	function closeDropdown(): void {
		isOpen = false;
	}

	/**
	 * Handle prompt selection
	 */
	async function handleSelect(promptId: string | null): Promise<void> {
		if (!conversationId) return;

		// Update in storage
		const result = await updateSystemPrompt(conversationId, promptId);
		if (result.success) {
			// Update in memory
			conversationsState.setSystemPrompt(conversationId, promptId);
			const promptName = promptId ? prompts.find((p) => p.id === promptId)?.name : null;
			toastState.success(promptName ? `Using "${promptName}"` : 'System prompt cleared');
		} else {
			toastState.error('Failed to update system prompt');
		}

		closeDropdown();
	}

	/**
	 * Handle click outside to close
	 */
	function handleClickOutside(event: MouseEvent): void {
		if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
			closeDropdown();
		}
	}

	/**
	 * Handle escape key
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && isOpen) {
			closeDropdown();
		}
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="relative" bind:this={dropdownElement}>
	<!-- Trigger button -->
	<button
		type="button"
		onclick={toggleDropdown}
		class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors {currentPrompt
			? 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30'
			: 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}"
		title={currentPrompt ? `System prompt: ${currentPrompt.name}` : 'Set system prompt'}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-3.5 w-3.5"
		>
			<path
				fill-rule="evenodd"
				d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
				clip-rule="evenodd"
			/>
		</svg>
		<span class="max-w-[120px] truncate">{buttonText}</span>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-3.5 w-3.5 transition-transform {isOpen ? 'rotate-180' : ''}"
		>
			<path
				fill-rule="evenodd"
				d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	<!-- Dropdown menu -->
	{#if isOpen}
		<div
			class="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
		>
			<!-- No prompt option -->
			<button
				type="button"
				onclick={() => handleSelect(null)}
				class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700 {!currentPromptId
					? 'bg-slate-700/50 text-slate-100'
					: 'text-slate-300'}"
			>
				<span class="flex-1">No system prompt</span>
				{#if !currentPromptId}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-4 w-4 text-emerald-400"
					>
						<path
							fill-rule="evenodd"
							d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
							clip-rule="evenodd"
						/>
					</svg>
				{/if}
			</button>

			{#if prompts.length > 0}
				<div class="my-1 border-t border-slate-700"></div>

				<!-- Available prompts -->
				{#each prompts as prompt}
					<button
						type="button"
						onclick={() => handleSelect(prompt.id)}
						class="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-slate-700 {currentPromptId ===
						prompt.id
							? 'bg-slate-700/50'
							: ''}"
					>
						<div class="flex items-center gap-2">
							<span
								class="flex-1 text-sm font-medium {currentPromptId === prompt.id
									? 'text-slate-100'
									: 'text-slate-300'}"
							>
								{prompt.name}
								{#if prompt.isDefault}
									<span class="ml-1 text-xs text-emerald-400">(default)</span>
								{/if}
							</span>
							{#if currentPromptId === prompt.id}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="h-4 w-4 text-emerald-400"
								>
									<path
										fill-rule="evenodd"
										d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
										clip-rule="evenodd"
									/>
								</svg>
							{/if}
						</div>
						{#if prompt.description}
							<span class="line-clamp-1 text-xs text-slate-500">{prompt.description}</span>
						{/if}
					</button>
				{/each}
			{:else}
				<div class="px-3 py-2 text-xs text-slate-500">
					No prompts available. <a href="/prompts" class="text-violet-400 hover:underline"
						>Create one</a
					>
				</div>
			{/if}
		</div>
	{/if}
</div>
