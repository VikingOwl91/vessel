<script lang="ts">
	/**
	 * AgentSelector - Dropdown to select an agent for the current conversation
	 * Agents define a system prompt and tool set for the conversation
	 */
	import { agentsState, conversationsState, toastState } from '$lib/stores';
	import { updateAgentId } from '$lib/storage';

	interface Props {
		conversationId?: string | null;
		currentAgentId?: string | null;
		/** Callback for 'new' mode - called when agent is selected without a conversation */
		onSelect?: (agentId: string | null) => void;
	}

	let { conversationId = null, currentAgentId = null, onSelect }: Props = $props();

	// UI state
	let isOpen = $state(false);
	let dropdownElement: HTMLDivElement | null = $state(null);

	// Available agents from store
	const agents = $derived(agentsState.sortedAgents);

	// Current agent for this conversation
	const currentAgent = $derived(
		currentAgentId ? agents.find((a) => a.id === currentAgentId) : null
	);

	// Display text for the button
	const buttonText = $derived(currentAgent?.name ?? 'No agent');

	function toggleDropdown(): void {
		isOpen = !isOpen;
	}

	function closeDropdown(): void {
		isOpen = false;
	}

	async function handleSelect(agentId: string | null): Promise<void> {
		// In 'new' mode (no conversation), use the callback
		if (!conversationId) {
			onSelect?.(agentId);
			const agentName = agentId ? agents.find((a) => a.id === agentId)?.name : null;
			toastState.success(agentName ? `Using "${agentName}"` : 'No agent selected');
			closeDropdown();
			return;
		}

		// Update in storage for existing conversation
		const result = await updateAgentId(conversationId, agentId);
		if (result.success) {
			conversationsState.setAgentId(conversationId, agentId);
			const agentName = agentId ? agents.find((a) => a.id === agentId)?.name : null;
			toastState.success(agentName ? `Using "${agentName}"` : 'No agent selected');
		} else {
			toastState.error('Failed to update agent');
		}

		closeDropdown();
	}

	function handleClickOutside(event: MouseEvent): void {
		if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
			closeDropdown();
		}
	}

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
		class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors {currentAgent
			? 'bg-indigo-500/20 text-indigo-300'
			: 'text-theme-muted hover:bg-theme-secondary hover:text-theme-secondary'}"
		title={currentAgent ? `Agent: ${currentAgent.name}` : 'Select an agent'}
	>
		<!-- Robot icon -->
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
			<path fill-rule="evenodd" d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06A.75.75 0 1 1 6.11 5.173L5.05 4.11a.75.75 0 0 1 0-1.06Zm9.9 0a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.061-1.06a.75.75 0 0 1 1.06 0ZM3 8a7 7 0 0 1 14 0v2a1 1 0 0 0 1 1h.25a.75.75 0 0 1 0 1.5H18v1a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1h-.25a.75.75 0 0 1 0-1.5H2a1 1 0 0 0 1-1V8Zm5.75 3.5a.75.75 0 0 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Zm4 0a.75.75 0 0 0-1.5 0v1a.75.75 0 0 0 1.5 0v-1Z" clip-rule="evenodd" />
		</svg>
		<span class="max-w-[100px] truncate">{buttonText}</span>
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

	<!-- Dropdown menu (opens upward) -->
	{#if isOpen}
		<div
			class="absolute bottom-full left-0 z-50 mb-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-theme bg-theme-secondary py-1 shadow-xl"
		>
			<!-- No agent option -->
			<div class="px-3 py-1.5 text-xs font-medium text-theme-muted uppercase tracking-wide">
				Default
			</div>
			<button
				type="button"
				onclick={() => handleSelect(null)}
				class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-theme-tertiary {!currentAgentId
					? 'bg-theme-tertiary/50 text-theme-primary'
					: 'text-theme-secondary'}"
			>
				<div class="flex-1">
					<span>No agent</span>
					<div class="mt-0.5 text-xs text-theme-muted">
						Use default tools and prompts
					</div>
				</div>
				{#if !currentAgentId}
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

			{#if agents.length > 0}
				<div class="my-1 border-t border-theme"></div>
				<div class="px-3 py-1.5 text-xs font-medium text-theme-muted uppercase tracking-wide">
					Your Agents
				</div>

				<!-- Available agents -->
				{#each agents as agent}
					<button
						type="button"
						onclick={() => handleSelect(agent.id)}
						class="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-theme-tertiary {currentAgentId === agent.id
							? 'bg-theme-tertiary/50'
							: ''}"
					>
						<div class="flex items-center gap-2">
							<span
								class="flex-1 text-sm font-medium {currentAgentId === agent.id
									? 'text-theme-primary'
									: 'text-theme-secondary'}"
							>
								{agent.name}
							</span>
							{#if currentAgentId === agent.id}
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
						{#if agent.description}
							<span class="line-clamp-1 text-xs text-theme-muted">{agent.description}</span>
						{/if}
						{#if agent.enabledToolNames.length > 0}
							<span class="text-[10px] text-indigo-400">
								{agent.enabledToolNames.length} tool{agent.enabledToolNames.length !== 1 ? 's' : ''}
							</span>
						{/if}
					</button>
				{/each}
			{:else}
				<div class="my-1 border-t border-theme"></div>
				<div class="px-3 py-2 text-xs text-theme-muted">
					No agents available. <a href="/settings?tab=agents" class="text-indigo-400 hover:underline"
						>Create one</a
					>
				</div>
			{/if}

			<!-- Link to agents settings -->
			<div class="mt-1 border-t border-theme"></div>
			<a
				href="/settings?tab=agents"
				class="flex items-center gap-2 px-3 py-2 text-xs text-theme-muted hover:bg-theme-tertiary hover:text-theme-secondary"
				onclick={closeDropdown}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
					<path fill-rule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clip-rule="evenodd" />
				</svg>
				Manage agents
			</a>
		</div>
	{/if}
</div>
