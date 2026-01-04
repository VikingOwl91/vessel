<script lang="ts">
	/**
	 * Settings page
	 * Comprehensive settings for appearance, models, memory, and more
	 */

	import { onMount } from 'svelte';
	import { modelsState, uiState, settingsState, promptsState } from '$lib/stores';
	import { modelPromptMappingsState } from '$lib/stores/model-prompt-mappings.svelte.js';
	import BackendSettings from '$lib/components/settings/BackendSettings.svelte';
	import ModelBrowser from '$lib/components/settings/ModelBrowser.svelte';
	import { modelInfoService, type ModelInfo } from '$lib/services/model-info-service.js';
	import { getPrimaryModifierDisplay } from '$lib/utils';
	import { PARAMETER_RANGES, PARAMETER_LABELS, PARAMETER_DESCRIPTIONS, AUTO_COMPACT_RANGES } from '$lib/types/settings';

	const modifierKey = getPrimaryModifierDisplay();

	// Model info cache for the settings page
	let modelInfoCache = $state<Map<string, ModelInfo>>(new Map());
	let isLoadingModelInfo = $state(false);

	// Load model info for all available models
	onMount(async () => {
		isLoadingModelInfo = true;
		try {
			const models = modelsState.chatModels;
			const infos = await Promise.all(
				models.map(async (model) => {
					const info = await modelInfoService.getModelInfo(model.name);
					return [model.name, info] as [string, ModelInfo];
				})
			);
			modelInfoCache = new Map(infos);
		} finally {
			isLoadingModelInfo = false;
		}
	});

	// Handle prompt selection for a model
	async function handleModelPromptChange(modelName: string, promptId: string | null): Promise<void> {
		await modelPromptMappingsState.setMapping(modelName, promptId);
	}

	// Get the currently mapped prompt ID for a model
	function getMappedPromptId(modelName: string): string | null {
		return modelPromptMappingsState.getMapping(modelName);
	}

	// Local state for default model selection
	let defaultModel = $state<string | null>(modelsState.selectedId);

	// Save default model when it changes
	function handleModelChange(): void {
		if (defaultModel) {
			modelsState.select(defaultModel);
		}
	}

	// Get current model defaults for reset functionality
	const currentModelDefaults = $derived(
		modelsState.selectedId ? modelsState.getModelDefaults(modelsState.selectedId) : undefined
	);
</script>

<div class="h-full overflow-y-auto bg-theme-primary p-6">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<div class="mb-8">
			<h1 class="text-2xl font-bold text-theme-primary">Settings</h1>
			<p class="mt-1 text-sm text-theme-muted">
				Configure appearance, model defaults, and behavior
			</p>
		</div>

		<!-- Appearance Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
				</svg>
				Appearance
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
				<!-- Dark Mode Toggle -->
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-theme-secondary">Dark Mode</p>
						<p class="text-xs text-theme-muted">Toggle between light and dark theme</p>
					</div>
					<button
						type="button"
						onclick={() => uiState.toggleDarkMode()}
						class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-theme {uiState.darkMode ? 'bg-purple-600' : 'bg-theme-tertiary'}"
						role="switch"
						aria-checked={uiState.darkMode}
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {uiState.darkMode ? 'translate-x-5' : 'translate-x-0'}"
						></span>
					</button>
				</div>

				<!-- System Theme Sync -->
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-theme-secondary">Use System Theme</p>
						<p class="text-xs text-theme-muted">Match your OS light/dark preference</p>
					</div>
					<button
						type="button"
						onclick={() => uiState.useSystemTheme()}
						class="rounded-lg bg-theme-tertiary px-3 py-1.5 text-xs font-medium text-theme-secondary transition-colors hover:bg-theme-hover"
					>
						Sync with System
					</button>
				</div>
			</div>
		</section>

		<!-- LLM Backends Section -->
		<BackendSettings />

		<!-- GGUF Model Browser Section -->
		<ModelBrowser />

		<!-- Chat Defaults Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
				</svg>
				Chat Defaults
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4">
				<div>
					<label for="default-model" class="text-sm font-medium text-theme-secondary">Default Model</label>
					<p class="text-xs text-theme-muted mb-2">Model used for new conversations</p>
					<select
						id="default-model"
						bind:value={defaultModel}
						onchange={handleModelChange}
						class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-secondary focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
					>
						{#each modelsState.chatModels as model}
							<option value={model.name}>{model.name}</option>
						{/each}
					</select>
				</div>
			</div>
		</section>

		<!-- Model-Prompt Defaults Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
				</svg>
				Model-Prompt Defaults
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4">
				<p class="text-sm text-theme-muted mb-4">
					Set default system prompts for specific models. When no other prompt is selected, the model's default will be used automatically.
				</p>

				{#if isLoadingModelInfo}
					<div class="flex items-center justify-center py-8">
						<div class="h-6 w-6 animate-spin rounded-full border-2 border-theme-subtle border-t-violet-500"></div>
						<span class="ml-2 text-sm text-theme-muted">Loading model info...</span>
					</div>
				{:else if modelsState.chatModels.length === 0}
					<p class="text-sm text-theme-muted py-4 text-center">
						No models available. Make sure Ollama is running.
					</p>
				{:else}
					<div class="space-y-3">
						{#each modelsState.chatModels as model (model.name)}
							{@const modelInfo = modelInfoCache.get(model.name)}
							{@const mappedPromptId = getMappedPromptId(model.name)}
							<div class="rounded-lg border border-theme-subtle bg-theme-tertiary p-3">
								<div class="flex items-start justify-between gap-4">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											<span class="font-medium text-theme-primary text-sm">{model.name}</span>
											{#if modelInfo?.capabilities && modelInfo.capabilities.length > 0}
												{#each modelInfo.capabilities as cap (cap)}
													<span class="rounded bg-violet-900/50 px-1.5 py-0.5 text-xs text-violet-300">
														{cap}
													</span>
												{/each}
											{/if}
											{#if modelInfo?.systemPrompt}
												<span class="rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-300" title="This model has a built-in system prompt">
													embedded
												</span>
											{/if}
										</div>
									</div>

									<select
										value={mappedPromptId ?? ''}
										onchange={(e) => {
											const value = e.currentTarget.value;
											handleModelPromptChange(model.name, value === '' ? null : value);
										}}
										class="rounded-lg border border-theme-subtle bg-theme-secondary px-2 py-1 text-sm text-theme-secondary focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
									>
										<option value="">
											{modelInfo?.systemPrompt ? 'Use embedded prompt' : 'No default'}
										</option>
										{#each promptsState.prompts as prompt (prompt.id)}
											<option value={prompt.id}>{prompt.name}</option>
										{/each}
									</select>
								</div>

								{#if modelInfo?.systemPrompt}
									<p class="mt-2 text-xs text-theme-muted line-clamp-2">
										<span class="font-medium text-amber-400">Embedded:</span> {modelInfo.systemPrompt}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</section>

		<!-- Model Parameters Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
				</svg>
				Model Parameters
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
				<!-- Use Custom Parameters Toggle -->
				<div class="flex items-center justify-between pb-4 border-b border-theme">
					<div>
						<p class="text-sm font-medium text-theme-secondary">Use Custom Parameters</p>
						<p class="text-xs text-theme-muted">Override model defaults with custom values</p>
					</div>
					<button
						type="button"
						onclick={() => settingsState.toggleCustomParameters(currentModelDefaults)}
						class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-theme {settingsState.useCustomParameters ? 'bg-orange-600' : 'bg-theme-tertiary'}"
						role="switch"
						aria-checked={settingsState.useCustomParameters}
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {settingsState.useCustomParameters ? 'translate-x-5' : 'translate-x-0'}"
						></span>
					</button>
				</div>

				{#if settingsState.useCustomParameters}
					<!-- Temperature -->
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="temperature" class="text-sm font-medium text-theme-secondary">{PARAMETER_LABELS.temperature}</label>
							<span class="text-sm text-theme-muted">{settingsState.temperature.toFixed(2)}</span>
						</div>
						<p class="text-xs text-theme-muted mb-2">{PARAMETER_DESCRIPTIONS.temperature}</p>
						<input
							id="temperature"
							type="range"
							min={PARAMETER_RANGES.temperature.min}
							max={PARAMETER_RANGES.temperature.max}
							step={PARAMETER_RANGES.temperature.step}
							value={settingsState.temperature}
							oninput={(e) => settingsState.updateParameter('temperature', parseFloat(e.currentTarget.value))}
							class="w-full accent-orange-500"
						/>
					</div>

					<!-- Top K -->
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="top_k" class="text-sm font-medium text-theme-secondary">{PARAMETER_LABELS.top_k}</label>
							<span class="text-sm text-theme-muted">{settingsState.top_k}</span>
						</div>
						<p class="text-xs text-theme-muted mb-2">{PARAMETER_DESCRIPTIONS.top_k}</p>
						<input
							id="top_k"
							type="range"
							min={PARAMETER_RANGES.top_k.min}
							max={PARAMETER_RANGES.top_k.max}
							step={PARAMETER_RANGES.top_k.step}
							value={settingsState.top_k}
							oninput={(e) => settingsState.updateParameter('top_k', parseInt(e.currentTarget.value))}
							class="w-full accent-orange-500"
						/>
					</div>

					<!-- Top P -->
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="top_p" class="text-sm font-medium text-theme-secondary">{PARAMETER_LABELS.top_p}</label>
							<span class="text-sm text-theme-muted">{settingsState.top_p.toFixed(2)}</span>
						</div>
						<p class="text-xs text-theme-muted mb-2">{PARAMETER_DESCRIPTIONS.top_p}</p>
						<input
							id="top_p"
							type="range"
							min={PARAMETER_RANGES.top_p.min}
							max={PARAMETER_RANGES.top_p.max}
							step={PARAMETER_RANGES.top_p.step}
							value={settingsState.top_p}
							oninput={(e) => settingsState.updateParameter('top_p', parseFloat(e.currentTarget.value))}
							class="w-full accent-orange-500"
						/>
					</div>

					<!-- Context Length -->
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="num_ctx" class="text-sm font-medium text-theme-secondary">{PARAMETER_LABELS.num_ctx}</label>
							<span class="text-sm text-theme-muted">{settingsState.num_ctx.toLocaleString()}</span>
						</div>
						<p class="text-xs text-theme-muted mb-2">{PARAMETER_DESCRIPTIONS.num_ctx}</p>
						<input
							id="num_ctx"
							type="range"
							min={PARAMETER_RANGES.num_ctx.min}
							max={PARAMETER_RANGES.num_ctx.max}
							step={PARAMETER_RANGES.num_ctx.step}
							value={settingsState.num_ctx}
							oninput={(e) => settingsState.updateParameter('num_ctx', parseInt(e.currentTarget.value))}
							class="w-full accent-orange-500"
						/>
					</div>

					<!-- Reset Button -->
					<div class="pt-2">
						<button
							type="button"
							onclick={() => settingsState.resetToDefaults(currentModelDefaults)}
							class="text-sm text-orange-400 hover:text-orange-300 transition-colors"
						>
							Reset to model defaults
						</button>
					</div>
				{:else}
					<p class="text-sm text-theme-muted py-2">
						Using model defaults. Enable custom parameters to adjust temperature, sampling, and context length.
					</p>
				{/if}
			</div>
		</section>

		<!-- Memory Management Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
				</svg>
				Memory Management
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
				<!-- Auto-Compact Toggle -->
				<div class="flex items-center justify-between pb-4 border-b border-theme">
					<div>
						<p class="text-sm font-medium text-theme-secondary">Auto-Compact</p>
						<p class="text-xs text-theme-muted">Automatically summarize older messages when context usage is high</p>
					</div>
					<button
						type="button"
						onclick={() => settingsState.toggleAutoCompact()}
						class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-theme {settingsState.autoCompactEnabled ? 'bg-emerald-600' : 'bg-theme-tertiary'}"
						role="switch"
						aria-checked={settingsState.autoCompactEnabled}
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {settingsState.autoCompactEnabled ? 'translate-x-5' : 'translate-x-0'}"
						></span>
					</button>
				</div>

				{#if settingsState.autoCompactEnabled}
					<!-- Threshold Slider -->
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="compact-threshold" class="text-sm font-medium text-theme-secondary">Context Threshold</label>
							<span class="text-sm text-theme-muted">{settingsState.autoCompactThreshold}%</span>
						</div>
						<p class="text-xs text-theme-muted mb-2">Trigger compaction when context usage exceeds this percentage</p>
						<input
							id="compact-threshold"
							type="range"
							min={AUTO_COMPACT_RANGES.threshold.min}
							max={AUTO_COMPACT_RANGES.threshold.max}
							step={AUTO_COMPACT_RANGES.threshold.step}
							value={settingsState.autoCompactThreshold}
							oninput={(e) => settingsState.updateAutoCompactThreshold(parseInt(e.currentTarget.value))}
							class="w-full accent-emerald-500"
						/>
						<div class="flex justify-between text-xs text-theme-muted mt-1">
							<span>{AUTO_COMPACT_RANGES.threshold.min}%</span>
							<span>{AUTO_COMPACT_RANGES.threshold.max}%</span>
						</div>
					</div>

					<!-- Preserve Count -->
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="preserve-count" class="text-sm font-medium text-theme-secondary">Messages to Preserve</label>
							<span class="text-sm text-theme-muted">{settingsState.autoCompactPreserveCount}</span>
						</div>
						<p class="text-xs text-theme-muted mb-2">Number of recent messages to keep intact (not summarized)</p>
						<input
							id="preserve-count"
							type="range"
							min={AUTO_COMPACT_RANGES.preserveCount.min}
							max={AUTO_COMPACT_RANGES.preserveCount.max}
							step={AUTO_COMPACT_RANGES.preserveCount.step}
							value={settingsState.autoCompactPreserveCount}
							oninput={(e) => settingsState.updateAutoCompactPreserveCount(parseInt(e.currentTarget.value))}
							class="w-full accent-emerald-500"
						/>
						<div class="flex justify-between text-xs text-theme-muted mt-1">
							<span>{AUTO_COMPACT_RANGES.preserveCount.min}</span>
							<span>{AUTO_COMPACT_RANGES.preserveCount.max}</span>
						</div>
					</div>
				{:else}
					<p class="text-sm text-theme-muted py-2">
						Enable auto-compact to automatically manage context usage. When enabled, older messages
						will be summarized when context usage exceeds your threshold.
					</p>
				{/if}
			</div>
		</section>

		<!-- Keyboard Shortcuts Section -->
		<section class="mb-8">
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
				</svg>
				Keyboard Shortcuts
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4">
				<div class="space-y-3">
					<div class="flex justify-between items-center">
						<span class="text-sm text-theme-secondary">New Chat</span>
						<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">{modifierKey}+N</kbd>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-sm text-theme-secondary">Search</span>
						<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">{modifierKey}+K</kbd>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-sm text-theme-secondary">Toggle Sidebar</span>
						<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">{modifierKey}+B</kbd>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-sm text-theme-secondary">Send Message</span>
						<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">Enter</kbd>
					</div>
					<div class="flex justify-between items-center">
						<span class="text-sm text-theme-secondary">New Line</span>
						<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">Shift+Enter</kbd>
					</div>
				</div>
			</div>
		</section>

		<!-- About Section -->
		<section>
			<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				About
			</h2>

			<div class="rounded-lg border border-theme bg-theme-secondary p-4">
				<div class="flex items-center gap-4">
					<div class="rounded-lg bg-theme-tertiary p-3">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
						</svg>
					</div>
					<div>
						<h3 class="font-semibold text-theme-primary">Vessel</h3>
						<p class="text-sm text-theme-muted">
							A modern interface for local AI with chat, tools, and memory management.
						</p>
					</div>
				</div>
			</div>
		</section>
	</div>
</div>
