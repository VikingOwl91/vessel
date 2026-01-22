<script lang="ts">
	/**
	 * SyncWarningBanner.svelte - Warning banner for sync failures
	 * Shows when backend is disconnected for >30 seconds continuously
	 */
	import { syncState } from '$lib/backend';
	import { onMount } from 'svelte';

	/** Threshold before showing banner (30 seconds) */
	const FAILURE_THRESHOLD_MS = 30_000;

	/** Track when failure started */
	let failureStartTime = $state<number | null>(null);

	/** Whether banner has been dismissed for this failure period */
	let isDismissed = $state(false);

	/** Whether enough time has passed to show banner */
	let thresholdReached = $state(false);

	/** Interval for checking threshold */
	let checkInterval: ReturnType<typeof setInterval> | null = null;

	/** Check if we're in a failure state */
	let isInFailureState = $derived(
		syncState.status === 'error' || syncState.status === 'offline' || !syncState.isOnline
	);

	/** Should show the banner */
	let shouldShow = $derived(isInFailureState && thresholdReached && !isDismissed);

	/** Watch for failure state changes */
	$effect(() => {
		if (isInFailureState) {
			// Start tracking failure time if not already
			if (failureStartTime === null) {
				failureStartTime = Date.now();
				isDismissed = false;
				thresholdReached = false;

				// Start interval to check threshold
				if (checkInterval) clearInterval(checkInterval);
				checkInterval = setInterval(() => {
					if (failureStartTime && Date.now() - failureStartTime >= FAILURE_THRESHOLD_MS) {
						thresholdReached = true;
						if (checkInterval) {
							clearInterval(checkInterval);
							checkInterval = null;
						}
					}
				}, 1000);
			}
		} else {
			// Reset on recovery
			failureStartTime = null;
			isDismissed = false;
			thresholdReached = false;
			if (checkInterval) {
				clearInterval(checkInterval);
				checkInterval = null;
			}
		}
	});

	onMount(() => {
		return () => {
			if (checkInterval) {
				clearInterval(checkInterval);
			}
		};
	});

	/** Dismiss the banner */
	function handleDismiss() {
		isDismissed = true;
	}
</script>

{#if shouldShow}
	<div
		class="fixed left-0 right-0 top-12 z-50 flex items-center justify-center px-4 animate-in"
		role="alert"
	>
		<div
			class="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-red-400 shadow-lg backdrop-blur-sm"
		>
			<!-- Warning icon -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5 flex-shrink-0"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
				/>
			</svg>

			<!-- Message -->
			<span class="text-sm font-medium">
				Backend not connected. Your data is only stored in this browser.
			</span>

			<!-- Pending count if any -->
			{#if syncState.pendingCount > 0}
				<span
					class="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium"
				>
					{syncState.pendingCount} pending
				</span>
			{/if}

			<!-- Dismiss button -->
			<button
				type="button"
				onclick={handleDismiss}
				class="ml-1 flex-shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
				aria-label="Dismiss sync warning"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	</div>
{/if}

<style>
	@keyframes slide-in-from-top {
		from {
			transform: translateY(-100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.animate-in {
		animation: slide-in-from-top 0.3s ease-out;
	}
</style>
