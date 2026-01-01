<script lang="ts">
	/**
	 * SidenavSearch.svelte - Search input for filtering conversations
	 * Uses local conversationsState for instant client-side filtering
	 */
	import { conversationsState } from '$lib/stores';

	// Handle input change - directly updates store for instant filtering
	function handleInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		conversationsState.searchQuery = value;
	}

	// Handle clear button
	function handleClear() {
		conversationsState.clearSearch();
	}
</script>

<div class="px-3 pb-2">
	<div class="relative">
		<!-- Search icon -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
			/>
		</svg>

		<!-- Search input -->
		<input
			type="text"
			value={conversationsState.searchQuery}
			oninput={handleInput}
			placeholder="Search conversations..."
			data-search-input
			class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary/50 py-2 pl-10 pr-9 text-sm text-theme-primary placeholder-theme-placeholder transition-colors focus:border-violet-500/50 focus:bg-theme-tertiary focus:outline-none focus:ring-1 focus:ring-violet-500/50"
		/>

		<!-- Clear button (visible when there's text) -->
		{#if conversationsState.searchQuery}
			<button
				type="button"
				onclick={handleClear}
				class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-theme-muted transition-colors hover:bg-theme-tertiary hover:text-theme-secondary"
				aria-label="Clear search"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>
</div>
