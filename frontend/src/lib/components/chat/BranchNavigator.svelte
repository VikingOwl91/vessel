<script lang="ts">
	/**
	 * BranchNavigator - Navigate between message branches
	 * Shows "< 1/3 >" style navigation for sibling messages
	 */

	import type { BranchInfo } from '$lib/types';

	interface Props {
		branchInfo: BranchInfo;
		onSwitch?: (direction: 'prev' | 'next') => void;
	}

	const { branchInfo, onSwitch }: Props = $props();

	// Reference to the navigator container for focus management
	let navigatorRef: HTMLElement | null = $state(null);

	// Track transition state for smooth animations
	let isTransitioning = $state(false);

	const currentDisplay = $derived(branchInfo.currentIndex + 1);
	const totalDisplay = $derived(branchInfo.totalCount);
	const canGoPrev = $derived(branchInfo.totalCount > 1);
	const canGoNext = $derived(branchInfo.totalCount > 1);

	/**
	 * Handle previous branch navigation with transition
	 */
	function handlePrev(): void {
		if (isTransitioning) return;
		isTransitioning = true;
		onSwitch?.('prev');
		// Reset transition state after animation completes
		setTimeout(() => {
			isTransitioning = false;
		}, 150);
	}

	/**
	 * Handle next branch navigation with transition
	 */
	function handleNext(): void {
		if (isTransitioning) return;
		isTransitioning = true;
		onSwitch?.('next');
		// Reset transition state after animation completes
		setTimeout(() => {
			isTransitioning = false;
		}, 150);
	}

	/**
	 * Handle keyboard navigation with arrow keys
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowLeft' && canGoPrev) {
			event.preventDefault();
			handlePrev();
		} else if (event.key === 'ArrowRight' && canGoNext) {
			event.preventDefault();
			handleNext();
		}
	}
</script>

<nav
	bind:this={navigatorRef}
	class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 transition-all duration-150 ease-out dark:bg-gray-700 dark:text-gray-300"
	class:opacity-50={isTransitioning}
	aria-label="Message branch navigation - Use left/right arrow keys to navigate"
	tabindex="0"
	onkeydown={handleKeydown}
>
	<button
		type="button"
		onclick={handlePrev}
		disabled={!canGoPrev || isTransitioning}
		class="rounded p-0.5 transition-all duration-150 hover:bg-gray-200 hover:scale-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-600"
		aria-label="Previous version ({currentDisplay} of {totalDisplay})"
		title="Previous version (Left Arrow)"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-3.5 w-3.5"
		>
			<path
				fill-rule="evenodd"
				d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	<span
		class="min-w-[3ch] select-none text-center font-medium transition-opacity duration-150"
		class:opacity-0={isTransitioning}
		aria-live="polite"
		aria-atomic="true"
	>
		{currentDisplay}/{totalDisplay}
	</span>

	<button
		type="button"
		onclick={handleNext}
		disabled={!canGoNext || isTransitioning}
		class="rounded p-0.5 transition-all duration-150 hover:bg-gray-200 hover:scale-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-600"
		aria-label="Next version ({currentDisplay} of {totalDisplay})"
		title="Next version (Right Arrow)"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			class="h-3.5 w-3.5"
		>
			<path
				fill-rule="evenodd"
				d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>
</nav>

<style>
	/* Focus ring style for keyboard navigation */
	nav:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
	}

	nav:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
	}
</style>
