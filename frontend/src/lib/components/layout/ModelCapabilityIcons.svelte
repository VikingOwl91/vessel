<script lang="ts">
	/**
	 * ModelCapabilityIcons.svelte - Compact capability icons for models
	 * Shows icons for vision, tools, code, etc. with hover tooltips
	 * Fetches capabilities from API on mount if not cached
	 */
	import { modelsState, CAPABILITY_INFO } from '$lib/stores';
	import type { OllamaCapability } from '$lib/ollama/types.js';

	interface Props {
		modelName: string;
		/** Show smaller icons for dropdown items */
		compact?: boolean;
	}

	const { modelName, compact = false }: Props = $props();

	// Capabilities to display (exclude 'completion' as it's universal)
	const DISPLAY_CAPABILITIES: OllamaCapability[] = [
		'vision',
		'tools',
		'code',
		'thinking',
		'uncensored',
		'cloud'
	];

	// Get cached capabilities
	const capabilities = $derived(modelsState.getCapabilities(modelName) ?? []);

	// Filter to displayable capabilities
	const displayCapabilities = $derived(
		capabilities.filter((cap) => DISPLAY_CAPABILITIES.includes(cap as OllamaCapability))
	);

	// Fetch capabilities if not cached
	$effect(() => {
		if (!modelsState.getCapabilities(modelName)) {
			modelsState.fetchCapabilities(modelName);
		}
	});

	/** Get icon info for a capability */
	function getCapabilityInfo(cap: string) {
		return CAPABILITY_INFO[cap] ?? { label: cap, icon: '?', color: 'slate' };
	}

	/** Get human-readable description for capability */
	function getCapabilityDescription(cap: string): string {
		const descriptions: Record<string, string> = {
			vision: 'Image input support',
			tools: 'Function calling',
			code: 'Optimized for programming',
			thinking: 'Reasoning/Chain-of-Thought',
			uncensored: 'No guardrails',
			cloud: 'Cloud offloading'
		};
		return descriptions[cap] ?? 'Unknown capability';
	}

	/** Get color class based on capability */
	function getColorClasses(color: string): { bg: string; text: string } {
		const colors: Record<string, { bg: string; text: string }> = {
			purple: { bg: 'bg-purple-900/50', text: 'text-purple-300' },
			blue: { bg: 'bg-blue-900/50', text: 'text-blue-300' },
			emerald: { bg: 'bg-emerald-900/50', text: 'text-emerald-300' },
			amber: { bg: 'bg-amber-900/50', text: 'text-amber-300' },
			red: { bg: 'bg-red-900/50', text: 'text-red-300' },
			sky: { bg: 'bg-sky-900/50', text: 'text-sky-300' },
			slate: { bg: 'bg-slate-800', text: 'text-slate-400' }
		};
		return colors[color] ?? colors.slate;
	}
</script>

{#if displayCapabilities.length > 0}
	<div class="flex items-center gap-0.5">
		{#each displayCapabilities as cap (cap)}
			{@const info = getCapabilityInfo(cap)}
			{@const colors = getColorClasses(info.color)}
			<span
				class="inline-flex items-center justify-center rounded-full {colors.bg} {colors.text} {compact
					? 'h-4 w-4 text-[10px]'
					: 'h-5 w-5 text-xs'}"
				title="{info.label}: {getCapabilityDescription(cap)}"
			>
				{info.icon}
			</span>
		{/each}
	</div>
{/if}
