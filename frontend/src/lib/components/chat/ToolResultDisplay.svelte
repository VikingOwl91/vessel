<script lang="ts">
	/**
	 * ToolResultDisplay - Beautifully formatted tool execution results
	 * Parses JSON results and displays them in a user-friendly way
	 */

	interface Props {
		content: string;
	}

	let { content }: Props = $props();

	interface ParsedResult {
		type: 'location' | 'search' | 'error' | 'text' | 'json' | 'fetch';
		data: unknown;
	}

	interface LocationData {
		location?: {
			city?: string;
			country?: string;
			latitude?: number;
			longitude?: number;
		};
		message?: string;
		source?: string;
	}

	interface SearchResult {
		rank: number;
		title: string;
		url: string;
		snippet: string;
	}

	interface SearchData {
		query?: string;
		resultCount?: number;
		results?: SearchResult[];
	}

	/**
	 * Try to extract JSON from text
	 */
	function extractJSON(text: string): unknown | null {
		// Try to find JSON object in text
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				return JSON.parse(jsonMatch[0]);
			} catch {
				return null;
			}
		}
		return null;
	}

	/**
	 * Parse the tool result content
	 */
	function parseResult(text: string): ParsedResult {
		// Check for error first
		if (text.includes('Tool error:') || text.includes('HTTP 403') || text.includes('HTTP 4') || text.includes('HTTP 5')) {
			const errorMatch = text.match(/(?:Tool error:\s*)?(.+)/);
			return { type: 'error', data: errorMatch?.[1]?.trim() || text };
		}

		// Try to extract JSON
		const json = extractJSON(text);
		if (json && typeof json === 'object') {
			const data = json as Record<string, unknown>;

			// Detect result type
			if (data.location && typeof data.location === 'object') {
				return { type: 'location', data };
			}
			if (data.results && Array.isArray(data.results) && data.query) {
				return { type: 'search', data };
			}
			if (data.title || data.text || data.url) {
				return { type: 'fetch', data };
			}

			return { type: 'json', data };
		}

		// Plain text result (might be scraped content)
		const cleanText = text.replace(/^Tool result:\s*/i, '').trim();
		if (cleanText.length > 0) {
			// Check if it looks like HTML garbage
			if (cleanText.includes('<script') || cleanText.includes('googletagmanager')) {
				return { type: 'error', data: 'Could not extract meaningful content from page' };
			}
			return { type: 'text', data: cleanText };
		}

		return { type: 'text', data: text };
	}

	const parsed = $derived(parseResult(content));
</script>

{#if parsed.type === 'location'}
	{@const loc = parsed.data as LocationData}
	<div class="my-3 overflow-hidden rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-500/10 to-pink-500/10">
		<div class="flex items-center gap-3 px-4 py-3">
			<span class="text-2xl">📍</span>
			<div>
				<p class="font-medium text-slate-100">
					{#if loc.location?.city}
						{loc.location.city}{#if loc.location.country}, {loc.location.country}{/if}
					{:else if loc.message}
						{loc.message}
					{:else}
						Location detected
					{/if}
				</p>
				{#if loc.source === 'ip'}
					<p class="text-xs text-slate-500">Based on IP address (approximate)</p>
				{:else if loc.source === 'gps'}
					<p class="text-xs text-slate-500">From device GPS</p>
				{/if}
			</div>
		</div>
	</div>

{:else if parsed.type === 'search'}
	{@const search = parsed.data as SearchData}
	<div class="my-3 space-y-2">
		<div class="flex items-center gap-2 text-sm text-slate-400">
			<span>🔍</span>
			<span>Found {search.resultCount || search.results?.length || 0} results for "{search.query}"</span>
		</div>

		{#if search.results && search.results.length > 0}
			<div class="space-y-2">
				{#each search.results.slice(0, 5) as result}
					<a
						href={result.url}
						target="_blank"
						rel="noopener noreferrer"
						class="block rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 transition-colors hover:border-blue-500/50 hover:bg-slate-800"
					>
						<div class="flex items-start gap-2">
							<span class="mt-0.5 text-blue-400">#{result.rank}</span>
							<div class="min-w-0 flex-1">
								<p class="font-medium text-blue-400 hover:underline">{result.title}</p>
								<p class="mt-0.5 truncate text-xs text-slate-500">{result.url}</p>
								{#if result.snippet && result.snippet !== '(no snippet available)'}
									<p class="mt-1 text-sm text-slate-400">{result.snippet}</p>
								{/if}
							</div>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>

{:else if parsed.type === 'error'}
	<div class="my-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
		<div class="flex items-center gap-2">
			<span class="text-red-400">⚠️</span>
			<span class="text-sm text-red-300">{parsed.data}</span>
		</div>
	</div>

{:else if parsed.type === 'fetch'}
	{@const data = parsed.data as Record<string, unknown>}
	<div class="my-3 overflow-hidden rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10">
		<div class="px-4 py-3">
			<div class="flex items-center gap-2 text-sm">
				<span>🌐</span>
				{#if data.title}
					<span class="font-medium text-slate-200">{data.title}</span>
				{:else if data.url}
					<a href={String(data.url)} target="_blank" rel="noopener noreferrer" class="text-violet-400 hover:underline">
						{data.url}
					</a>
				{:else}
					<span class="text-slate-400">Fetched content</span>
				{/if}
			</div>
			{#if data.text && typeof data.text === 'string'}
				<p class="mt-2 line-clamp-4 text-sm text-slate-400">{data.text.substring(0, 300)}{data.text.length > 300 ? '...' : ''}</p>
			{/if}
		</div>
	</div>

{:else if parsed.type === 'json'}
	{@const data = parsed.data as Record<string, unknown>}
	<div class="my-3 rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
		<pre class="overflow-x-auto text-xs text-slate-400">{JSON.stringify(data, null, 2)}</pre>
	</div>

{:else}
	<!-- Fallback: just show the text (if not empty/whitespace) -->
	{#if typeof parsed.data === 'string' && parsed.data.trim().length > 0}
		<div class="my-3 rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
			<p class="text-sm text-slate-300">{parsed.data}</p>
		</div>
	{/if}
{/if}
