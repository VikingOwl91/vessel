<script lang="ts">
	/**
	 * HtmlPreview - Sandboxed HTML/CSS/JS preview in an iframe
	 * Renders HTML code in an isolated sandbox for safe preview
	 */

	interface Props {
		/** HTML content to render */
		html: string;
		/** Optional title for the preview */
		title?: string;
		/** Initial height in pixels */
		height?: number;
	}

	const props: Props = $props();

	// Derive values from props
	const html = $derived(props.html);
	const title = $derived(props.title ?? 'Preview');
	const height = $derived(props.height ?? 300);

	// State
	let iframeRef: HTMLIFrameElement | null = $state(null);
	let isExpanded = $state(false);
	// actualHeight tracks the current display height, synced from prop when not expanded
	let actualHeight = $state(props.height ?? 300);

	// Sync actualHeight when height prop changes (only when not expanded)
	$effect(() => {
		if (!isExpanded) {
			actualHeight = height;
		}
	});

	// Generate a complete HTML document if the code is just a fragment
	const fullHtml = $derived.by(() => {
		const trimmed = html.trim();

		// Check if it's already a complete document
		if (trimmed.toLowerCase().startsWith('<!doctype') || trimmed.toLowerCase().startsWith('<html')) {
			return trimmed;
		}

		// Check if it has a body tag
		if (trimmed.toLowerCase().includes('<body')) {
			return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n${trimmed}\n</html>`;
		}

		// Wrap in a complete document with basic styles
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 16px;
			font-family: system-ui, -apple-system, sans-serif;
			line-height: 1.5;
			color: #1a1a1a;
			background: #ffffff;
		}
	</style>
</head>
<body>
${trimmed}
</body>
</html>`;
	});

	// Create blob URL for the iframe
	const blobUrl = $derived.by(() => {
		const blob = new Blob([fullHtml], { type: 'text/html' });
		return URL.createObjectURL(blob);
	});

	// Clean up blob URL when component unmounts
	$effect(() => {
		const url = blobUrl;
		return () => {
			URL.revokeObjectURL(url);
		};
	});

	/**
	 * Toggle expanded view
	 */
	function toggleExpand(): void {
		isExpanded = !isExpanded;
		actualHeight = isExpanded ? 600 : height;
	}

	/**
	 * Open in new tab
	 */
	function openInNewTab(): void {
		window.open(blobUrl, '_blank');
	}

	/**
	 * Refresh the preview
	 */
	function refresh(): void {
		if (iframeRef) {
			iframeRef.src = blobUrl;
		}
	}
</script>

<div class="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-gray-700 px-4 py-2">
		<div class="flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-orange-400" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16 8 8 0 000-16zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.56-.5-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.56.5.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.498-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.03 11H4.083a6.004 6.004 0 002.783 4.118z" clip-rule="evenodd" />
			</svg>
			<span class="text-sm font-medium text-gray-300">{title}</span>
		</div>
		<div class="flex items-center gap-1">
			<!-- Refresh button -->
			<button
				type="button"
				onclick={refresh}
				class="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
				aria-label="Refresh preview"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
				</svg>
			</button>

			<!-- Expand/collapse button -->
			<button
				type="button"
				onclick={toggleExpand}
				class="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
				aria-label={isExpanded ? 'Collapse preview' : 'Expand preview'}
			>
				{#if isExpanded}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" />
					</svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 11-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 110 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 110-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clip-rule="evenodd" />
					</svg>
				{/if}
			</button>

			<!-- Open in new tab button -->
			<button
				type="button"
				onclick={openInNewTab}
				class="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
				aria-label="Open in new tab"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
					<path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
					<path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Preview iframe -->
	<div class="bg-white" style="height: {actualHeight}px;">
		<iframe
			bind:this={iframeRef}
			src={blobUrl}
			title={title}
			class="h-full w-full border-0"
			sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
		></iframe>
	</div>
</div>
