<script lang="ts">
	/**
	 * AboutTab - App information, version, and update status
	 */
	import { versionState } from '$lib/stores';

	const GITHUB_URL = 'https://github.com/VikingOwl91/vessel';
	const ISSUES_URL = `${GITHUB_URL}/issues`;
	const LICENSE = 'MIT';

	async function handleCheckForUpdates(): Promise<void> {
		await versionState.checkForUpdates();
	}

	function formatLastChecked(timestamp: number): string {
		if (!timestamp) return 'Never';
		const date = new Date(timestamp);
		return date.toLocaleString();
	}
</script>

<div class="space-y-8">
	<!-- App Identity -->
	<section>
		<div class="flex items-center gap-6">
			<div class="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" viewBox="0 0 24 24">
					<path d="M12 20 L4 6 Q4 5 5 5 L8 5 L12 12.5 L16 5 L19 5 Q20 5 20 6 L12 20 Z" fill="white"/>
				</svg>
			</div>
			<div>
				<h1 class="text-3xl font-bold text-theme-primary">Vessel</h1>
				<p class="mt-1 text-theme-muted">
					A modern interface for local AI with chat, tools, and memory management.
				</p>
				{#if versionState.current}
					<div class="mt-2 flex items-center gap-2">
						<span class="rounded-full bg-emerald-500/20 px-3 py-0.5 text-sm font-medium text-emerald-400">
							v{versionState.current}
						</span>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<!-- Version & Updates -->
	<section>
		<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
			</svg>
			Updates
		</h2>

		<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
			{#if versionState.hasUpdate}
				<div class="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
					</svg>
					<div class="flex-1">
						<p class="font-medium text-amber-200">Update Available</p>
						<p class="text-sm text-amber-300/80">
							Version {versionState.latest} is available. You're currently on v{versionState.current}.
						</p>
					</div>
				</div>
			{:else}
				<div class="flex items-center gap-3">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
					</svg>
					<span class="text-sm text-theme-secondary">You're running the latest version</span>
				</div>
			{/if}

			<div class="flex flex-wrap gap-3">
				<button
					type="button"
					onclick={handleCheckForUpdates}
					disabled={versionState.isChecking}
					class="flex items-center gap-2 rounded-lg bg-theme-tertiary px-4 py-2 text-sm font-medium text-theme-secondary transition-colors hover:bg-theme-hover disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{#if versionState.isChecking}
						<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Checking...
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
						</svg>
						Check for Updates
					{/if}
				</button>

				{#if versionState.hasUpdate && versionState.updateUrl}
					<a
						href={versionState.updateUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
						</svg>
						Download v{versionState.latest}
					</a>
				{/if}
			</div>

			{#if versionState.lastChecked}
				<p class="text-xs text-theme-muted">
					Last checked: {formatLastChecked(versionState.lastChecked)}
				</p>
			{/if}
		</div>
	</section>

	<!-- Links -->
	<section>
		<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
			</svg>
			Links
		</h2>

		<div class="grid gap-3 sm:grid-cols-2">
			<a
				href={GITHUB_URL}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-3 rounded-lg border border-theme bg-theme-secondary p-4 transition-colors hover:bg-theme-tertiary"
			>
				<svg class="h-6 w-6 text-theme-secondary" fill="currentColor" viewBox="0 0 24 24">
					<path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" />
				</svg>
				<div>
					<p class="font-medium text-theme-primary">GitHub Repository</p>
					<p class="text-xs text-theme-muted">Source code and releases</p>
				</div>
			</a>

			<a
				href={ISSUES_URL}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-3 rounded-lg border border-theme bg-theme-secondary p-4 transition-colors hover:bg-theme-tertiary"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-theme-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0 1 12 12.75Zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 0 1-1.152 6.06M12 12.75c-2.883 0-5.647.508-8.208 1.44.125 2.104.52 4.136 1.153 6.06M12 12.75a2.25 2.25 0 0 0 2.248-2.354M12 12.75a2.25 2.25 0 0 1-2.248-2.354M12 8.25c.995 0 1.971-.08 2.922-.236.403-.066.74-.358.795-.762a3.778 3.778 0 0 0-.399-2.25M12 8.25c-.995 0-1.97-.08-2.922-.236-.402-.066-.74-.358-.795-.762a3.734 3.734 0 0 1 .4-2.253M12 8.25a2.25 2.25 0 0 0-2.248 2.146M12 8.25a2.25 2.25 0 0 1 2.248 2.146M8.683 5a6.032 6.032 0 0 1-1.155-1.002c.07-.63.27-1.222.574-1.747m.581 2.749A3.75 3.75 0 0 1 15.318 5m0 0c.427-.283.815-.62 1.155-.999a4.471 4.471 0 0 0-.575-1.752M4.921 6a24.048 24.048 0 0 0-.392 3.314c1.668.546 3.416.914 5.223 1.082M19.08 6c.205 1.08.337 2.187.392 3.314a23.882 23.882 0 0 1-5.223 1.082" />
				</svg>
				<div>
					<p class="font-medium text-theme-primary">Report an Issue</p>
					<p class="text-xs text-theme-muted">Bug reports and feature requests</p>
				</div>
			</a>
		</div>
	</section>

	<!-- Tech Stack & License -->
	<section>
		<h2 class="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
			</svg>
			Technical Info
		</h2>

		<div class="rounded-lg border border-theme bg-theme-secondary p-4 space-y-4">
			<div>
				<p class="text-sm font-medium text-theme-secondary">Built With</p>
				<div class="mt-2 flex flex-wrap gap-2">
					<span class="rounded-full bg-orange-500/20 px-3 py-1 text-xs font-medium text-orange-300">Svelte 5</span>
					<span class="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300">SvelteKit</span>
					<span class="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-300">Go</span>
					<span class="rounded-full bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-300">Tailwind CSS</span>
					<span class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300">Ollama</span>
					<span class="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300">llama.cpp</span>
				</div>
			</div>

			<div class="border-t border-theme pt-4">
				<p class="text-sm font-medium text-theme-secondary">License</p>
				<p class="mt-1 text-sm text-theme-muted">
					Released under the <span class="text-theme-secondary">{LICENSE}</span> license
				</p>
			</div>
		</div>
	</section>
</div>
