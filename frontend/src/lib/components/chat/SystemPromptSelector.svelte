<script lang="ts">
	/**
	 * SystemPromptSelector - Dropdown to select a system prompt for the current conversation
	 * Now model-aware: shows embedded prompts and resolved source indicators
	 */
	import { promptsState, conversationsState, toastState } from '$lib/stores';
	import { updateSystemPrompt } from '$lib/storage';
	import { modelInfoService } from '$lib/services/model-info-service.js';
	import { modelPromptMappingsState } from '$lib/stores/model-prompt-mappings.svelte.js';
	import {
		resolveSystemPrompt,
		getPromptSourceLabel,
		type PromptSource
	} from '$lib/services/prompt-resolution.js';

	interface Props {
		conversationId?: string | null;
		currentPromptId?: string | null;
		/** Model name for model-aware prompt resolution */
		modelName?: string;
		/** Callback for 'new' mode - called when prompt is selected without a conversation */
		onSelect?: (promptId: string | null) => void;
	}

	let { conversationId = null, currentPromptId = null, modelName = '', onSelect }: Props = $props();

	// UI state
	let isOpen = $state(false);
	let dropdownElement: HTMLDivElement | null = $state(null);

	// Model info state
	let hasEmbeddedPrompt = $state(false);
	let modelCapabilities = $state<string[]>([]);
	let resolvedSource = $state<PromptSource>('none');
	let resolvedPromptName = $state<string | undefined>(undefined);

	// Available prompts from store
	const prompts = $derived(promptsState.prompts);

	// Current prompt for this conversation (explicit override)
	const currentPrompt = $derived(
		currentPromptId ? prompts.find((p) => p.id === currentPromptId) : null
	);

	// Check if there's a model-prompt mapping
	const hasModelMapping = $derived(modelName ? modelPromptMappingsState.hasMapping(modelName) : false);

	// Display text for the button
	const buttonText = $derived.by(() => {
		if (currentPrompt) return currentPrompt.name;
		if (resolvedPromptName && resolvedSource !== 'none') return resolvedPromptName;
		return 'No system prompt';
	});

	// Source badge color
	const sourceBadgeClass = $derived.by(() => {
		switch (resolvedSource) {
			case 'per-conversation':
			case 'new-chat-selection':
				return 'bg-violet-500/20 text-violet-300';
			case 'model-mapping':
				return 'bg-blue-500/20 text-blue-300';
			case 'model-embedded':
				return 'bg-amber-500/20 text-amber-300';
			case 'capability-match':
				return 'bg-emerald-500/20 text-emerald-300';
			case 'global-active':
				return 'bg-slate-500/20 text-slate-300';
			default:
				return 'bg-slate-500/20 text-slate-400';
		}
	});

	// Load model info when modelName changes
	$effect(() => {
		if (modelName) {
			loadModelInfo();
		}
	});

	// Resolve prompt when relevant state changes
	$effect(() => {
		// Depend on these values to trigger re-resolution
		const _promptId = currentPromptId;
		const _model = modelName;
		if (modelName) {
			resolveCurrentPrompt();
		}
	});

	async function loadModelInfo(): Promise<void> {
		if (!modelName) return;
		try {
			const info = await modelInfoService.getModelInfo(modelName);
			hasEmbeddedPrompt = info.systemPrompt !== null;
			modelCapabilities = info.capabilities;
		} catch {
			hasEmbeddedPrompt = false;
			modelCapabilities = [];
		}
	}

	async function resolveCurrentPrompt(): Promise<void> {
		if (!modelName) return;
		try {
			const resolved = await resolveSystemPrompt(modelName, currentPromptId, null);
			resolvedSource = resolved.source;
			resolvedPromptName = resolved.promptName;
		} catch {
			resolvedSource = 'none';
			resolvedPromptName = undefined;
		}
	}

	function toggleDropdown(): void {
		isOpen = !isOpen;
	}

	function closeDropdown(): void {
		isOpen = false;
	}

	async function handleSelect(promptId: string | null): Promise<void> {
		// In 'new' mode (no conversation), use the callback
		if (!conversationId) {
			onSelect?.(promptId);
			const promptName = promptId ? prompts.find((p) => p.id === promptId)?.name : null;
			toastState.success(promptName ? `Using "${promptName}"` : 'Using model default');
			closeDropdown();
			return;
		}

		// Update in storage for existing conversation
		const result = await updateSystemPrompt(conversationId, promptId);
		if (result.success) {
			conversationsState.setSystemPrompt(conversationId, promptId);
			const promptName = promptId ? prompts.find((p) => p.id === promptId)?.name : null;
			toastState.success(promptName ? `Using "${promptName}"` : 'Using model default');
		} else {
			toastState.error('Failed to update system prompt');
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
		class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors {resolvedSource !== 'none'
			? sourceBadgeClass
			: 'text-theme-muted hover:bg-theme-secondary hover:text-theme-secondary'}"
		title={resolvedPromptName ? `System prompt: ${resolvedPromptName}` : 'Set system prompt'}
	>
		<!-- Icon based on source -->
		{#if resolvedSource === 'model-embedded'}
			<!-- Chip/CPU icon for embedded -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
				<path d="M14 6H6v8h8V6Z" />
				<path fill-rule="evenodd" d="M9.25 3V1.75a.75.75 0 0 1 1.5 0V3h1.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.75 2.75 0 0 1 17 5.75v.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v1.5h1.25a.75.75 0 0 1 0 1.5H17v.5A2.75 2.75 0 0 1 14.25 17h-.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-1.5v1.25a.75.75 0 0 1-1.5 0V17h-.5A2.75 2.75 0 0 1 3 14.25v-.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-1.5H1.75a.75.75 0 0 1 0-1.5H3v-.5A2.75 2.75 0 0 1 5.75 3h.5V1.75a.75.75 0 0 1 1.5 0V3h1.5ZM4.5 5.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-8.5Z" clip-rule="evenodd" />
			</svg>
		{:else}
			<!-- Default info icon -->
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
		{/if}
		<span class="max-w-[120px] truncate">{buttonText}</span>
		<!-- Source indicator badge -->
		{#if resolvedSource !== 'none' && resolvedSource !== 'per-conversation' && resolvedSource !== 'new-chat-selection'}
			<span class="rounded px-1 py-0.5 text-[10px] opacity-75">
				{getPromptSourceLabel(resolvedSource)}
			</span>
		{/if}
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
			class="absolute bottom-full left-0 z-50 mb-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-theme bg-theme-secondary py-1 shadow-xl"
		>
			<!-- Model default section -->
			<div class="px-3 py-1.5 text-xs font-medium text-theme-muted uppercase tracking-wide">
				Model Default
			</div>
			<button
				type="button"
				onclick={() => handleSelect(null)}
				class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-theme-tertiary {!currentPromptId
					? 'bg-theme-tertiary/50 text-theme-primary'
					: 'text-theme-secondary'}"
			>
				<div class="flex-1">
					<div class="flex items-center gap-2">
						<span>Use model default</span>
						{#if hasEmbeddedPrompt}
							<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
								Has embedded prompt
							</span>
						{/if}
					</div>
					{#if !currentPromptId && resolvedSource !== 'none'}
						<div class="mt-0.5 text-xs text-theme-muted">
							Currently: {resolvedPromptName ?? 'None'}
						</div>
					{/if}
				</div>
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
				<div class="my-1 border-t border-theme"></div>
				<div class="px-3 py-1.5 text-xs font-medium text-theme-muted uppercase tracking-wide">
					Your Prompts
				</div>

				<!-- Available prompts -->
				{#each prompts as prompt}
					<button
						type="button"
						onclick={() => handleSelect(prompt.id)}
						class="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-theme-tertiary {currentPromptId ===
						prompt.id
							? 'bg-theme-tertiary/50'
							: ''}"
					>
						<div class="flex items-center gap-2">
							<span
								class="flex-1 text-sm font-medium {currentPromptId === prompt.id
									? 'text-theme-primary'
									: 'text-theme-secondary'}"
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
							<span class="line-clamp-1 text-xs text-theme-muted">{prompt.description}</span>
						{/if}
					</button>
				{/each}
			{:else}
				<div class="my-1 border-t border-theme"></div>
				<div class="px-3 py-2 text-xs text-theme-muted">
					No prompts available. <a href="/prompts" class="text-violet-400 hover:underline"
						>Create one</a
					>
				</div>
			{/if}

			<!-- Link to model defaults settings -->
			<div class="mt-1 border-t border-theme"></div>
			<a
				href="/settings#model-prompts"
				class="flex items-center gap-2 px-3 py-2 text-xs text-theme-muted hover:bg-theme-tertiary hover:text-theme-secondary"
				onclick={closeDropdown}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
					<path fill-rule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clip-rule="evenodd" />
				</svg>
				Configure model defaults
			</a>
		</div>
	{/if}
</div>
