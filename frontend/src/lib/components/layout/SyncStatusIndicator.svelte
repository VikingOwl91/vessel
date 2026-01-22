<script lang="ts">
	/**
	 * SyncStatusIndicator.svelte - Compact sync status indicator for TopNav
	 * Shows connection status with backend: synced, syncing, error, or offline
	 */
	import { syncState } from '$lib/backend';

	/** Computed status for display */
	let displayStatus = $derived.by(() => {
		if (syncState.status === 'offline' || !syncState.isOnline) {
			return 'offline';
		}
		if (syncState.status === 'error') {
			return 'error';
		}
		if (syncState.status === 'syncing') {
			return 'syncing';
		}
		return 'synced';
	});

	/** Tooltip text based on status */
	let tooltipText = $derived.by(() => {
		switch (displayStatus) {
			case 'offline':
				return 'Backend offline - data stored locally only';
			case 'error':
				return syncState.lastError
					? `Sync error: ${syncState.lastError}`
					: 'Sync error - check backend connection';
			case 'syncing':
				return 'Syncing...';
			case 'synced':
				if (syncState.lastSyncTime) {
					const ago = getTimeAgo(syncState.lastSyncTime);
					return `Synced ${ago}`;
				}
				return 'Synced';
		}
	});

	/** Format relative time */
	function getTimeAgo(date: Date): string {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		return `${Math.floor(seconds / 86400)}d ago`;
	}
</script>

<div class="relative flex items-center" title={tooltipText}>
	<!-- Status dot -->
	<span
		class="inline-block h-2 w-2 rounded-full {displayStatus === 'synced'
			? 'bg-emerald-500'
			: displayStatus === 'syncing'
				? 'animate-pulse bg-amber-500'
				: 'bg-red-500'}"
		aria-hidden="true"
	></span>

	<!-- Pending count badge (only when error/offline with pending items) -->
	{#if (displayStatus === 'error' || displayStatus === 'offline') && syncState.pendingCount > 0}
		<span
			class="ml-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-500"
		>
			{syncState.pendingCount}
		</span>
	{/if}
</div>
