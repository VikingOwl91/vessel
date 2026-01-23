<script lang="ts">
	/**
	 * Root layout component
	 * Sets up the main app structure with sidenav and top navigation
	 */

	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { chatState, conversationsState, modelsState, uiState, promptsState, versionState, projectsState } from '$lib/stores';
	import { backendsState, type BackendType } from '$lib/stores/backends.svelte';
	import { getAllConversations } from '$lib/storage';
	import { syncManager } from '$lib/backend';
	import { keyboardShortcuts, getShortcuts } from '$lib/utils';
	import { scheduleMigration } from '$lib/services/chat-index-migration.js';
	import Sidenav from '$lib/components/layout/Sidenav.svelte';
	import TopNav from '$lib/components/layout/TopNav.svelte';
	import ModelSelect from '$lib/components/layout/ModelSelect.svelte';
	import { ToastContainer, ShortcutsModal } from '$lib/components/shared';
	import UpdateBanner from '$lib/components/shared/UpdateBanner.svelte';
	import SyncWarningBanner from '$lib/components/shared/SyncWarningBanner.svelte';

	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	// LocalStorage key for persisting backend selection
	const BACKEND_STORAGE_KEY = 'vessel:selectedBackend';

	// Flag to track if initial backend restoration is complete
	let backendRestoreComplete = $state(false);

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	// Sidenav width constant
	const SIDENAV_WIDTH = 280;

	// Shortcuts modal state
	let showShortcutsModal = $state(false);

	// Model name for non-Ollama backends
	let nonOllamaModelName = $state<string | null>(null);
	let modelFetchFailed = $state(false);

	// Fetch model name when backend changes to non-Ollama
	$effect(() => {
		const backendType = backendsState.activeType;
		if (backendType && backendType !== 'ollama') {
			fetchNonOllamaModel();
		} else {
			nonOllamaModelName = null;
			modelFetchFailed = false;
		}
	});

	/**
	 * Fetch model name from unified API for non-Ollama backends
	 */
	async function fetchNonOllamaModel(): Promise<void> {
		modelFetchFailed = false;
		nonOllamaModelName = null;
		try {
			const response = await fetch('/api/v1/ai/models');
			if (response.ok) {
				const data = await response.json();
				if (data.models && data.models.length > 0) {
					// Extract just the model name (strip path/extension for cleaner display)
					const fullName = data.models[0].name;
					nonOllamaModelName = fullName.replace(/\.gguf$/i, '');
				} else {
					// No models loaded
					modelFetchFailed = true;
				}
			} else {
				modelFetchFailed = true;
			}
		} catch (err) {
			console.error('Failed to fetch model from backend:', err);
			modelFetchFailed = true;
		}
	}

	/**
	 * Persist backend selection to localStorage
	 */
	function persistBackendSelection(type: BackendType): void {
		try {
			localStorage.setItem(BACKEND_STORAGE_KEY, type);
		} catch (err) {
			console.error('Failed to persist backend selection:', err);
		}
	}

	/**
	 * Restore last selected backend if it's available
	 */
	async function restoreLastBackend(): Promise<void> {
		try {
			const lastBackend = localStorage.getItem(BACKEND_STORAGE_KEY) as BackendType | null;
			if (lastBackend && lastBackend !== backendsState.activeType) {
				// Check if the last backend is connected
				const backend = backendsState.get(lastBackend);
				if (backend?.status === 'connected') {
					await backendsState.setActive(lastBackend);
				}
			}
		} catch (err) {
			console.error('Failed to restore backend selection:', err);
		} finally {
			// Mark restore as complete so persistence effect can start working
			backendRestoreComplete = true;
		}
	}

	// Watch for backend changes and persist (only after initial restore is complete)
	$effect(() => {
		const activeType = backendsState.activeType;
		if (activeType && backendRestoreComplete) {
			persistBackendSelection(activeType);
		}
	});

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

		// Load projects from IndexedDB
		projectsState.load();

		// Restore last selected backend after backends finish loading
		backendsState.ready().then(() => restoreLastBackend());

		// Schedule background migration for chat indexing (runs after 5 seconds)
		scheduleMigration(5000);

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

		// Search (Cmd/Ctrl + K) - navigates to search page
		keyboardShortcuts.register({
			...SHORTCUTS.SEARCH,
			preventDefault: true,
			handler: () => {
				goto('/search');
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
					{#if backendsState.activeType === 'ollama'}
						<ModelSelect />
					{:else if backendsState.activeBackend}
						<!-- Non-Ollama backend indicator with model name -->
						<div class="flex items-center gap-2 rounded-lg border border-theme bg-theme-secondary/50 px-3 py-2 text-sm">
							<svg class="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
							</svg>
							<div class="flex flex-col">
								<span class="font-medium text-theme-primary">
									{#if nonOllamaModelName}
										{nonOllamaModelName}
									{:else if modelFetchFailed}
										<span class="text-amber-400">No model loaded</span>
									{:else}
										Loading...
									{/if}
								</span>
								<span class="text-xs text-theme-muted">
									{backendsState.activeType === 'llamacpp' ? 'llama.cpp' : 'LM Studio'}
								</span>
							</div>
						</div>
					{/if}
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

<!-- Sync warning banner (shows when backend disconnected) -->
<SyncWarningBanner />

<!-- Keyboard shortcuts help -->
<ShortcutsModal isOpen={showShortcutsModal} onClose={() => (showShortcutsModal = false)} />
