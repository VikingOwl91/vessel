<script lang="ts">
	/**
	 * KnowledgeTab - Knowledge Base management
	 */
	import { onMount } from 'svelte';
	import {
		listDocuments,
		addDocument,
		deleteDocument,
		getKnowledgeBaseStats,
		formatTokenCount,
		EMBEDDING_MODELS,
		DEFAULT_EMBEDDING_MODEL
	} from '$lib/memory';
	import type { StoredDocument } from '$lib/storage/db';
	import { toastState, modelsState } from '$lib/stores';

	let documents = $state<StoredDocument[]>([]);
	let stats = $state({ documentCount: 0, chunkCount: 0, totalTokens: 0 });
	let isLoading = $state(true);
	let isUploading = $state(false);
	let uploadProgress = $state({ current: 0, total: 0 });
	let selectedModel = $state(DEFAULT_EMBEDDING_MODEL);
	let dragOver = $state(false);

	let fileInput: HTMLInputElement;

	onMount(async () => {
		await refreshData();
	});

	async function refreshData() {
		isLoading = true;
		try {
			documents = await listDocuments();
			stats = await getKnowledgeBaseStats();
		} catch (error) {
			console.error('Failed to load documents:', error);
			toastState.error('Failed to load knowledge base');
		} finally {
			isLoading = false;
		}
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			await processFiles(Array.from(input.files));
		}
		input.value = '';
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;

		if (event.dataTransfer?.files) {
			await processFiles(Array.from(event.dataTransfer.files));
		}
	}

	async function processFiles(files: File[]) {
		isUploading = true;

		for (const file of files) {
			try {
				const content = await file.text();

				if (!content.trim()) {
					toastState.warning(`File "${file.name}" is empty, skipping`);
					continue;
				}

				await addDocument(file.name, content, file.type || 'text/plain', {
					embeddingModel: selectedModel,
					onProgress: (current, total) => {
						uploadProgress = { current, total };
					}
				});

				toastState.success(`Added "${file.name}" to knowledge base`);
			} catch (error) {
				console.error(`Failed to process ${file.name}:`, error);
				toastState.error(`Failed to add "${file.name}"`);
			}
		}

		await refreshData();
		isUploading = false;
		uploadProgress = { current: 0, total: 0 };
	}

	async function handleDelete(doc: StoredDocument) {
		if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) {
			return;
		}

		try {
			await deleteDocument(doc.id);
			toastState.success(`Deleted "${doc.name}"`);
			await refreshData();
		} catch (error) {
			console.error('Failed to delete document:', error);
			toastState.error('Failed to delete document');
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div>
	<!-- Header -->
	<div class="mb-8">
		<h2 class="text-xl font-bold text-theme-primary">Knowledge Base</h2>
		<p class="mt-1 text-sm text-theme-muted">
			Upload documents to enhance AI responses with your own knowledge
		</p>
	</div>

	<!-- Stats -->
	<div class="mb-6 grid grid-cols-3 gap-4">
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Documents</p>
			<p class="mt-1 text-2xl font-semibold text-theme-primary">{stats.documentCount}</p>
		</div>
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Chunks</p>
			<p class="mt-1 text-2xl font-semibold text-theme-primary">{stats.chunkCount}</p>
		</div>
		<div class="rounded-lg border border-theme bg-theme-secondary p-4">
			<p class="text-sm text-theme-muted">Total Tokens</p>
			<p class="mt-1 text-2xl font-semibold text-theme-primary">{formatTokenCount(stats.totalTokens)}</p>
		</div>
	</div>

	<!-- Upload Area -->
	<div class="mb-8">
		<div class="mb-3 flex items-center justify-between">
			<h3 class="text-lg font-semibold text-theme-primary">Upload Documents</h3>
			<select
				bind:value={selectedModel}
				class="rounded-md border border-theme-subtle bg-theme-tertiary px-3 py-1.5 text-sm text-theme-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			>
				{#each EMBEDDING_MODELS as model}
					<option value={model}>{model}</option>
				{/each}
			</select>
		</div>

		<button
			type="button"
			class="w-full rounded-lg border-2 border-dashed p-8 text-center transition-colors {dragOver
				? 'border-blue-500 bg-blue-900/20'
				: 'border-theme-subtle hover:border-theme'}"
			ondragover={(e) => { e.preventDefault(); dragOver = true; }}
			ondragleave={() => (dragOver = false)}
			ondrop={handleDrop}
			onclick={() => fileInput?.click()}
			disabled={isUploading}
		>
			{#if isUploading}
				<div class="flex flex-col items-center">
					<svg class="h-8 w-8 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="mt-3 text-sm text-theme-muted">Processing... ({uploadProgress.current}/{uploadProgress.total} chunks)</p>
				</div>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
				</svg>
				<p class="mt-3 text-sm text-theme-muted">Drag and drop files here, or click to browse</p>
				<p class="mt-1 text-xs text-theme-muted">Supports .txt, .md, .json, and other text files</p>
			{/if}
		</button>

		<input
			bind:this={fileInput}
			type="file"
			multiple
			accept=".txt,.md,.json,.csv,.xml,.html"
			onchange={handleFileSelect}
			class="hidden"
		/>
	</div>

	<!-- Documents List -->
	<div>
		<h3 class="mb-4 text-lg font-semibold text-theme-primary">Documents</h3>

		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<svg class="h-8 w-8 animate-spin text-theme-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
			</div>
		{:else if documents.length === 0}
			<div class="rounded-lg border border-dashed border-theme bg-theme-secondary/50 p-8 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
				</svg>
				<h4 class="mt-4 text-sm font-medium text-theme-muted">No documents yet</h4>
				<p class="mt-1 text-sm text-theme-muted">Upload documents to build your knowledge base</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each documents as doc (doc.id)}
					<div class="flex items-center justify-between rounded-lg border border-theme bg-theme-secondary p-4">
						<div class="flex items-center gap-3">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
							</svg>
							<div>
								<h4 class="font-medium text-theme-primary">{doc.name}</h4>
								<p class="text-xs text-theme-muted">{formatSize(doc.size)} · {doc.chunkCount} chunks · Added {formatDate(doc.createdAt)}</p>
							</div>
						</div>

						<button
							type="button"
							onclick={() => handleDelete(doc)}
							class="rounded p-2 text-theme-muted transition-colors hover:bg-red-900/30 hover:text-red-400"
							aria-label="Delete document"
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
							</svg>
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Info Section -->
	<section class="mt-8 rounded-lg border border-theme bg-theme-secondary/50 p-4">
		<h4 class="flex items-center gap-2 text-sm font-medium text-theme-secondary">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			How RAG Works
		</h4>
		<p class="mt-2 text-sm text-theme-muted">
			Documents are split into chunks and converted to embeddings. When you ask a question,
			relevant chunks are found by similarity search and included in the AI's context.
		</p>
		{#if !modelsState.hasEmbeddingModel}
			<p class="mt-2 text-sm text-amber-400">
				<strong>No embedding model found.</strong> Install one to use the knowledge base:
				<code class="ml-1 rounded bg-theme-tertiary px-1 text-theme-muted">ollama pull nomic-embed-text</code>
			</p>
		{:else}
			<p class="mt-2 text-sm text-emerald-400">
				Embedding model available: {modelsState.embeddingModels[0]?.name}
				{#if modelsState.embeddingModels.length > 1}
					<span class="text-theme-muted">(+{modelsState.embeddingModels.length - 1} more)</span>
				{/if}
			</p>
		{/if}
	</section>
</div>
