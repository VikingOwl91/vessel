<script lang="ts">
	/**
	 * ShortcutsModal - Display available keyboard shortcuts
	 */
	import { keyboardShortcuts, formatShortcut, type Shortcut } from '$lib/utils/keyboard';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen, onClose }: Props = $props();

	// Get all registered shortcuts
	const shortcuts = $derived(keyboardShortcuts.getShortcuts());

	// Group shortcuts by category
	const groupedShortcuts = $derived.by(() => {
		const groups: Record<string, Shortcut[]> = {
			'Navigation': [],
			'Chat': [],
			'General': []
		};

		for (const shortcut of shortcuts) {
			if (['new-chat', 'search', 'toggle-sidenav'].includes(shortcut.id)) {
				groups['Navigation'].push(shortcut);
			} else if (['focus-input', 'send-message', 'stop-generation'].includes(shortcut.id)) {
				groups['Chat'].push(shortcut);
			} else {
				groups['General'].push(shortcut);
			}
		}

		return groups;
	});

	/**
	 * Handle backdrop click to close
	 */
	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	/**
	 * Handle escape key to close
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="shortcuts-dialog-title"
	>
		<!-- Dialog -->
		<div class="mx-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-slate-700 px-6 py-4">
				<h2 id="shortcuts-dialog-title" class="text-lg font-semibold text-slate-100">
					Keyboard Shortcuts
				</h2>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
					aria-label="Close dialog"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="max-h-[60vh] overflow-y-auto px-6 py-4">
				{#each Object.entries(groupedShortcuts) as [group, items]}
					{#if items.length > 0}
						<div class="mb-4 last:mb-0">
							<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
								{group}
							</h3>
							<div class="space-y-2">
								{#each items as shortcut}
									<div class="flex items-center justify-between">
										<span class="text-sm text-slate-300">{shortcut.description}</span>
										<kbd class="rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-400">
											{formatShortcut(shortcut.key, shortcut.modifiers)}
										</kbd>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>

			<!-- Footer -->
			<div class="border-t border-slate-700 px-6 py-3">
				<p class="text-center text-xs text-slate-500">
					Press <kbd class="rounded bg-slate-800 px-1.5 py-0.5 font-mono">Shift+?</kbd> to toggle this panel
				</p>
			</div>
		</div>
	</div>
{/if}
