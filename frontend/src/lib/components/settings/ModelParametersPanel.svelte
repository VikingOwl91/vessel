<script lang="ts">
	/**
	 * ModelParametersPanel - Collapsible panel for adjusting model generation parameters
	 * Shows sliders for temperature, top_k, top_p, and context length
	 */

	import { settingsState } from '$lib/stores/settings.svelte';
	import { modelsState, type ModelDefaults } from '$lib/stores/models.svelte';
	import {
		PARAMETER_RANGES,
		PARAMETER_LABELS,
		PARAMETER_DESCRIPTIONS,
		DEFAULT_MODEL_PARAMETERS,
		type ModelParameters
	} from '$lib/types/settings';

	// Parameter keys for iteration
	const parameterKeys: (keyof ModelParameters)[] = ['temperature', 'top_k', 'top_p', 'num_ctx'];

	// Track model defaults for the selected model
	let modelDefaults = $state<ModelDefaults>({});

	// Fetch model defaults when panel opens or model changes
	$effect(() => {
		if (settingsState.isPanelOpen && modelsState.selectedId) {
			modelsState.fetchModelDefaults(modelsState.selectedId).then((defaults) => {
				modelDefaults = defaults;
			});
		}
	});

	/**
	 * Get the default value for a parameter (from model or hardcoded fallback)
	 */
	function getDefaultValue(key: keyof ModelParameters): number {
		const modelValue = modelDefaults[key];
		return modelValue ?? DEFAULT_MODEL_PARAMETERS[key];
	}

	/**
	 * Format a parameter value for display
	 */
	function formatValue(key: keyof ModelParameters, value: number): string {
		switch (key) {
			case 'temperature':
			case 'top_p':
				return value.toFixed(2);
			case 'top_k':
				return value.toString();
			case 'num_ctx':
				return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toString();
			default:
				return value.toString();
		}
	}

	/**
	 * Get current value for a parameter
	 */
	function getValue(key: keyof ModelParameters): number {
		return settingsState.modelParameters[key];
	}

	/**
	 * Handle slider change
	 */
	function handleSliderChange(key: keyof ModelParameters, event: Event): void {
		const target = event.target as HTMLInputElement;
		settingsState.updateParameter(key, parseFloat(target.value));
	}
</script>

{#if settingsState.isPanelOpen}
	<div
		class="rounded-lg border border-theme/50 bg-theme-secondary/50 p-4"
		role="region"
		aria-label="Model parameters"
	>
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<h3 class="text-sm font-medium text-theme-secondary">Model Parameters</h3>
			<button
				type="button"
				onclick={() => settingsState.closePanel()}
				class="rounded p-1 text-theme-muted hover:bg-theme-tertiary hover:text-theme-secondary"
				aria-label="Close settings panel"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Enable custom parameters toggle -->
		<div class="mb-4 flex items-center justify-between">
			<label class="flex items-center gap-2 text-sm text-theme-secondary">
				<span>Use custom parameters</span>
			</label>
			<button
				type="button"
				role="switch"
				aria-checked={settingsState.useCustomParameters}
				onclick={() => settingsState.toggleCustomParameters(modelDefaults)}
				class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-theme-secondary {settingsState.useCustomParameters ? 'bg-sky-600' : 'bg-theme-tertiary'}"
			>
				<span
					class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {settingsState.useCustomParameters ? 'translate-x-4' : 'translate-x-0'}"
				></span>
			</button>
		</div>

		<!-- Parameters (disabled when not using custom) -->
		<div class="space-y-4" class:opacity-50={!settingsState.useCustomParameters}>
			{#each parameterKeys as key}
				{@const range = PARAMETER_RANGES[key]}
				{@const value = getValue(key)}
				{@const isDefault = value === getDefaultValue(key)}

				<div>
					<div class="mb-1 flex items-center justify-between">
						<label for="param-{key}" class="text-xs font-medium text-theme-secondary">
							{PARAMETER_LABELS[key]}
							{#if !isDefault}
								<span class="ml-1 text-sky-400">*</span>
							{/if}
						</label>
						<span class="font-mono text-xs text-theme-muted">
							{formatValue(key, value)}
						</span>
					</div>

					<input
						type="range"
						id="param-{key}"
						min={range.min}
						max={range.max}
						step={range.step}
						value={value}
						oninput={(e) => handleSliderChange(key, e)}
						disabled={!settingsState.useCustomParameters}
						class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-theme-tertiary disabled:cursor-not-allowed [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-500 disabled:[&::-webkit-slider-thumb]:bg-theme-muted"
						title={PARAMETER_DESCRIPTIONS[key]}
					/>

					<p class="mt-0.5 text-[10px] text-theme-muted">
						{PARAMETER_DESCRIPTIONS[key]}
					</p>
				</div>
			{/each}
		</div>

		<!-- Reset button -->
		<div class="mt-4 flex justify-end">
			<button
				type="button"
				onclick={() => settingsState.resetToDefaults(modelDefaults)}
				class="rounded px-2 py-1 text-xs text-theme-muted hover:bg-theme-tertiary hover:text-theme-secondary"
			>
				Reset to defaults
			</button>
		</div>
	</div>
{/if}
