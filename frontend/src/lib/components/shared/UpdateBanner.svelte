<script lang="ts">
	/**
	 * UpdateBanner.svelte - Notification banner for new version availability
	 * Shows when a new version is available and hasn't been dismissed
	 */
	import { versionState } from '$lib/stores/version.svelte.js';

	/** Dismiss the current update notification */
	function handleDismiss() {
		if (versionState.latest) {
			versionState.dismissUpdate(versionState.latest);
		}
	}
</script>

{#if versionState.shouldShowNotification && versionState.latest}
	<div
		class="fixed left-0 right-0 top-12 z-50 flex items-center justify-center px-4 animate-in"
		role="alert"
	>
		<div
			class="flex items-center gap-3 rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-teal-400 shadow-lg backdrop-blur-sm"
		>
			<!-- Update icon -->
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
					d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
				/>
			</svg>

			<!-- Message -->
			<span class="text-sm font-medium">
				Vessel v{versionState.latest} is available
			</span>

			<!-- View release link -->
			{#if versionState.updateUrl}
				<a
					href={versionState.updateUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm font-medium text-teal-300 underline underline-offset-2 transition-colors hover:text-teal-200"
				>
					View Release
				</a>
			{/if}

			<!-- Dismiss button -->
			<button
				type="button"
				onclick={handleDismiss}
				class="ml-1 flex-shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
				aria-label="Dismiss update notification"
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
