<script lang="ts">
	/**
	 * Root layout component
	 * Sets up the main app structure with sidenav and top navigation
	 */

	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { chatState, conversationsState, modelsState, uiState, promptsState, versionState } from '$lib/stores';
	import { getAllConversations } from '$lib/storage';
	import { syncManager } from '$lib/backend';
	import { keyboardShortcuts, getShortcuts } from '$lib/utils';
	import Sidenav from '$lib/components/layout/Sidenav.svelte';
	import TopNav from '$lib/components/layout/TopNav.svelte';
	import ModelSelect from '$lib/components/layout/ModelSelect.svelte';
	import { ToastContainer, ShortcutsModal, SearchModal } from '$lib/components/shared';
	import UpdateBanner from '$lib/components/shared/UpdateBanner.svelte';

	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	// Sidenav width constant
	const SIDENAV_WIDTH = 280;

	// Search modal state
	let showSearchModal = $state(false);

	// Shortcuts modal state
	let showShortcutsModal = $state(false);

	onMount(() => {
		// Initialize UI state (handles responsive detection, theme, etc.)
		uiState.initialize();

		// Initialize sync manager (backend communication)
		syncManager.initialize();

		// Initialize version checker (update notifications)
		versionState.initialize();

		// Initialize keyboard shortcuts
		keyboardShortcuts.initialize();
		registerKeyboardShortcuts();

		// Load models from preloaded data
		if (data.models && data.models.length > 0) {
			modelsState.available = data.models;
			// Try to load persisted model selection first
			modelsState.loadPersistedSelection();
			// Auto-select first chat model if none selected (chatModels filters out middleware)
			if (!modelsState.selectedId && modelsState.chatModels.length > 0) {
				modelsState.selectedId = modelsState.chatModels[0].name;
			}
		} else if (data.modelsError) {
			modelsState.error = data.modelsError;
		}

		// Load conversations from IndexedDB
		loadConversations();

		return () => {
			uiState.destroy();
			syncManager.destroy();
			versionState.destroy();
			keyboardShortcuts.destroy();
		};
	});

	/**
	 * Register keyboard shortcuts
	 */
	function registerKeyboardShortcuts(): void {
		const SHORTCUTS = getShortcuts();

		// New chat (Cmd/Ctrl + N)
		keyboardShortcuts.register({
			...SHORTCUTS.NEW_CHAT,
			preventDefault: true,
			handler: () => {
				chatState.reset();
				goto('/');
			}
		});

		// Search (Cmd/Ctrl + K) - opens global search modal
		keyboardShortcuts.register({
			...SHORTCUTS.SEARCH,
			preventDefault: true,
			handler: () => {
				showSearchModal = true;
			}
		});

		// Toggle sidenav (Cmd/Ctrl + B)
		keyboardShortcuts.register({
			...SHORTCUTS.TOGGLE_SIDENAV,
			preventDefault: true,
			handler: () => {
				uiState.toggleSidenav();
			}
		});

		// Focus chat input (Cmd/Alt + /)
		keyboardShortcuts.register({
			...SHORTCUTS.FOCUS_INPUT,
			preventDefault: true,
			handler: () => {
				const chatInput = document.querySelector('[data-chat-input]') as HTMLTextAreaElement;
				chatInput?.focus();
			}
		});

		// Show keyboard shortcuts (Shift + ?)
		keyboardShortcuts.register({
			...SHORTCUTS.SHOW_SHORTCUTS,
			preventDefault: true,
			handler: () => {
				showShortcutsModal = !showShortcutsModal;
			}
		});
	}

	/**
	 * Load conversations from IndexedDB storage
	 */
	async function loadConversations(): Promise<void> {
		const result = await getAllConversations();
		if (result.success) {
			conversationsState.load(result.data);
		} else {
			console.error('Failed to load conversations:', result.error);
			conversationsState.load([]);
		}
	}

	/**
	 * Navigate to home (used after delete/archive)
	 */
	function handleNavigateHome(): void {
		goto('/');
	}
</script>

<div class="h-screen w-full overflow-hidden bg-theme-primary">
	<!-- Sidenav - fixed position -->
	<Sidenav />

	<!-- Main content wrapper - shifts right when sidenav is open on desktop -->
	<div
		class="flex h-full flex-col bg-theme-primary transition-[margin-left] duration-300 ease-in-out"
		style="margin-left: {!uiState.isMobile && uiState.sidenavOpen ? SIDENAV_WIDTH : 0}px"
	>
		<!-- Top navigation - fixed at top of content area -->
		<header class="relative z-40 flex-shrink-0">
			<TopNav onNavigateHome={handleNavigateHome}>
				{#snippet modelSelect()}
					<ModelSelect />
				{/snippet}
			</TopNav>
		</header>

		<!-- Page content - scrollable -->
		<main class="flex-1 overflow-hidden">
			{@render children()}
		</main>
	</div>
</div>

<!-- Toast notifications -->
<ToastContainer />

<!-- Update notification banner -->
<UpdateBanner />

<!-- Keyboard shortcuts help -->
<ShortcutsModal isOpen={showShortcutsModal} onClose={() => (showShortcutsModal = false)} />

<!-- Global search modal -->
<SearchModal isOpen={showSearchModal} onClose={() => (showSearchModal = false)} />
