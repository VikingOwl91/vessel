<script lang="ts">
	/**
	 * ToolDocs - Inline documentation panel for tool creation
	 */

	interface Props {
		language: 'javascript' | 'python';
		isOpen?: boolean;
		onclose?: () => void;
	}

	const { language, isOpen = false, onclose }: Props = $props();
</script>

{#if isOpen}
	<div class="rounded-lg border border-theme-subtle bg-theme-tertiary/50 p-4">
		<div class="flex items-center justify-between mb-3">
			<h4 class="text-sm font-medium text-theme-primary">
				{language === 'javascript' ? 'JavaScript' : 'Python'} Tool Guide
			</h4>
			{#if onclose}
				<button
					type="button"
					onclick={onclose}
					class="text-theme-muted hover:text-theme-primary"
					aria-label="Close documentation"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
					</svg>
				</button>
			{/if}
		</div>

		<div class="space-y-4 text-sm text-theme-secondary">
			{#if language === 'javascript'}
				<!-- JavaScript Documentation -->
				<div>
					<h5 class="font-medium text-theme-primary mb-1">Arguments</h5>
					<p>Access parameters via the <code class="bg-theme-primary/30 px-1 rounded text-xs">args</code> object:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>const name = args.name;
const count = args.count || 10;</code></pre>
				</div>

				<div>
					<h5 class="font-medium text-theme-primary mb-1">Return Value</h5>
					<p>Return any JSON-serializable value:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>return {'{'}
  success: true,
  data: result
{'}'};</code></pre>
				</div>

				<div>
					<h5 class="font-medium text-theme-primary mb-1">Async/Await</h5>
					<p>Full async support - use await for API calls:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>const res = await fetch(args.url);
const data = await res.json();
return data;</code></pre>
				</div>

				<div>
					<h5 class="font-medium text-theme-primary mb-1">Error Handling</h5>
					<p>Throw errors to signal failures:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>if (!args.required_param) {'{'}
  throw new Error('Missing required param');
{'}'}</code></pre>
				</div>
			{:else}
				<!-- Python Documentation -->
				<div>
					<h5 class="font-medium text-theme-primary mb-1">Arguments</h5>
					<p>Access parameters via the <code class="bg-theme-primary/30 px-1 rounded text-xs">args</code> dict:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>name = args.get('name')
count = args.get('count', 10)</code></pre>
				</div>

				<div>
					<h5 class="font-medium text-theme-primary mb-1">Return Value</h5>
					<p>Print JSON to stdout (import json first):</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>import json

result = {'{'}'success': True, 'data': data{'}'}
print(json.dumps(result))</code></pre>
				</div>

				<div>
					<h5 class="font-medium text-theme-primary mb-1">Available Modules</h5>
					<p>Python standard library is available:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>import json, math, re
import hashlib, base64
import urllib.request
from collections import Counter</code></pre>
				</div>

				<div>
					<h5 class="font-medium text-theme-primary mb-1">Error Handling</h5>
					<p>Print error JSON or raise exceptions:</p>
					<pre class="mt-1 p-2 rounded bg-theme-primary/20 text-xs overflow-x-auto"><code>try:
    # risky operation
except Exception as e:
    print(json.dumps({'{'}'error': str(e){'}'})</code></pre>
				</div>
			{/if}

			<div class="pt-2 border-t border-theme-subtle">
				<h5 class="font-medium text-theme-primary mb-1">Tips</h5>
				<ul class="list-disc list-inside space-y-1 text-xs text-theme-muted">
					<li>Tools run with a 30-second timeout</li>
					<li>Large outputs are truncated at 100KB</li>
					<li>Network requests are allowed</li>
					<li>Use descriptive error messages for debugging</li>
				</ul>
			</div>
		</div>
	</div>
{/if}
