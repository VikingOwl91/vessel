<script lang="ts">
	/**
	 * GeneralTab - General settings including appearance, defaults, shortcuts, and about
	 */
	import { modelsState, uiState } from '$lib/stores';
	import { getPrimaryModifierDisplay } from '$lib/utils';

	const modifierKey = getPrimaryModifierDisplay();

	// Local state for default model selection
	let defaultModel = $state<string | null>(modelsState.selectedId);

	// Save default model when it changes
	function handleModelChange(): void {
		if (defaultModel) {
			modelsState.select(defaultModel);
		}
	}
</script>

<div class="space-y-8">
	<!-- Appearance Section -->
	<section>
		<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
			</svg>
			Appearance
		</h2>

		<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
			<!-- Dark Mode Toggle -->
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-theme-secondary">Dark Mode</p>
					<p class="text-xs text-theme-muted">Toggle between light and dark theme</p>
				</div>
				<button
					type="button"
					onclick={() => uiState.toggleDarkMode()}
					class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-theme {uiState.darkMode ? 'bg-purple-600' : 'bg-theme-tertiary'}"
					role="switch"
					aria-checked={uiState.darkMode}
				>
					<span
						class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {uiState.darkMode ? 'translate-x-5' : 'translate-x-0'}"
					></span>
				</button>
			</div>

			<!-- System Theme Sync -->
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-theme-secondary">Use System Theme</p>
					<p class="text-xs text-theme-muted">Match your OS light/dark preference</p>
				</div>
				<button
					type="button"
					onclick={() => uiState.useSystemTheme()}
					class="rounded-lg bg-theme-tertiary px-3 py-1.5 text-xs font-medium text-theme-secondary transition-colors hover:bg-theme-hover"
				>
					Sync with System
				</button>
			</div>
		</div>
	</section>

	<!-- Chat Defaults Section -->
	<section>
		<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
			</svg>
			Chat Defaults
		</h2>

		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<div>
				<label for="default-model" class="text-sm font-medium text-theme-secondary">Default Model</label>
				<p class="text-xs text-theme-muted mb-2">Model used for new conversations</p>
				<select
					id="default-model"
					bind:value={defaultModel}
					onchange={handleModelChange}
					class="w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-secondary focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
				>
					{#each modelsState.chatModels as model}
						<option value={model.name}>{model.name}</option>
					{/each}
				</select>
			</div>
		</div>
	</section>

	<!-- Keyboard Shortcuts Section -->
	<section>
		<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
			</svg>
			Keyboard Shortcuts
		</h2>

		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<div class="space-y-3">
				<div class="flex justify-between items-center">
					<span class="text-sm text-theme-secondary">New Chat</span>
					<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">{modifierKey}+N</kbd>
				</div>
				<div class="flex justify-between items-center">
					<span class="text-sm text-theme-secondary">Search</span>
					<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">{modifierKey}+K</kbd>
				</div>
				<div class="flex justify-between items-center">
					<span class="text-sm text-theme-secondary">Toggle Sidebar</span>
					<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">{modifierKey}+B</kbd>
				</div>
				<div class="flex justify-between items-center">
					<span class="text-sm text-theme-secondary">Send Message</span>
					<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">Enter</kbd>
				</div>
				<div class="flex justify-between items-center">
					<span class="text-sm text-theme-secondary">New Line</span>
					<kbd class="rounded bg-theme-tertiary px-2 py-1 font-mono text-xs text-theme-muted">Shift+Enter</kbd>
				</div>
			</div>
		</div>
	</section>

</div>
