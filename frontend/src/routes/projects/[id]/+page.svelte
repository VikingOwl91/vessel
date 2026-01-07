<script lang="ts">
	/**
	 * Project detail page
	 * Shows project header, new chat input, conversations, and files
	 */
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { projectsState, conversationsState, modelsState, toastState, chatState } from '$lib/stores';
	import { createConversation as createStoredConversation } from '$lib/storage';
	import { getProjectStats, getProjectLinks, type ProjectLink } from '$lib/storage/projects.js';
	import {
		listDocuments,
		addDocumentAsync,
		deleteDocument,
		DEFAULT_EMBEDDING_MODEL,
		EMBEDDING_MODELS
	} from '$lib/memory';
	import type { StoredDocument } from '$lib/storage/db';
	import ProjectModal from '$lib/components/projects/ProjectModal.svelte';

	// Get project ID from URL
	const projectId = $derived($page.params.id);

	// Project data
	const project = $derived.by(() => {
		return projectsState.projects.find(p => p.id === projectId) || null;
	});

	// Project conversations
	const projectConversations = $derived.by(() => {
		if (!projectId) return [];
		return conversationsState.forProject(projectId);
	});

	// State
	let searchQuery = $state('');
	let newChatMessage = $state('');
	let isCreatingChat = $state(false);
	let showProjectModal = $state(false);
	let links = $state<ProjectLink[]>([]);
	let documents = $state<StoredDocument[]>([]);
	let isLoadingDocs = $state(false);
	let selectedEmbeddingModel = $state(DEFAULT_EMBEDDING_MODEL);
	let activeTab = $state<'chats' | 'files' | 'links'>('chats');
	let fileInput: HTMLInputElement;
	let dragOver = $state(false);

	// Filtered conversations based on search
	const filteredConversations = $derived.by(() => {
		if (!searchQuery.trim()) return projectConversations;
		const query = searchQuery.toLowerCase();
		return projectConversations.filter(c =>
			c.title.toLowerCase().includes(query)
		);
	});

	// Load project data on mount
	onMount(async () => {
		if (!project) {
			// Project not found, redirect to home
			goto('/');
			return;
		}
		await loadProjectData();
	});

	async function loadProjectData() {
		if (!projectId) return;

		// Load links
		const linksResult = await getProjectLinks(projectId);
		if (linksResult.success) {
			links = linksResult.data;
		}

		// Load documents filtered by projectId
		isLoadingDocs = true;
		try {
			const allDocs = await listDocuments();
			// Filter documents by projectId - strict equality
			documents = allDocs.filter(d => d.projectId === projectId);
		} catch (err) {
			console.error('Failed to load documents:', err);
			documents = [];
		} finally {
			isLoadingDocs = false;
		}
	}

	async function handleCreateChat() {
		if (!newChatMessage.trim() || isCreatingChat) return;

		const model = modelsState.selectedId;
		if (!model) {
			toastState.error('No model selected');
			return;
		}

		isCreatingChat = true;

		try {
			// Generate title from message
			const title = generateTitle(newChatMessage);

			// Create conversation with projectId
			const result = await createStoredConversation({
				title,
				model,
				isPinned: false,
				isArchived: false,
				projectId
			});

			if (result.success) {
				// Add to conversations state
				conversationsState.add(result.data);

				// Store the message content before clearing
				const messageContent = newChatMessage;
				newChatMessage = '';

				// Navigate to the new chat
				// The chat page will handle the first message
				goto(`/chat/${result.data.id}?firstMessage=${encodeURIComponent(messageContent)}`);
			} else {
				toastState.error('Failed to create chat');
			}
		} catch {
			toastState.error('Failed to create chat');
		} finally {
			isCreatingChat = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleCreateChat();
		}
	}

	function generateTitle(content: string): string {
		const firstLine = content.split('\n')[0].trim();
		const firstSentence = firstLine.split(/[.!?]/)[0].trim();
		if (firstSentence.length <= 50) {
			return firstSentence || 'New Chat';
		}
		return firstSentence.substring(0, 47) + '...';
	}

	function formatDate(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));

		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return `${days} days ago`;

		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}

	// File upload handlers
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
		if (!projectId) {
			toastState.error('Project ID not available');
			return;
		}

		for (const file of files) {
			try {
				const content = await file.text();
				if (!content.trim()) {
					toastState.warning(`File "${file.name}" is empty, skipping`);
					continue;
				}

				// Add document async - stores immediately, embeds in background
				await addDocumentAsync(file.name, content, file.type || 'text/plain', {
					embeddingModel: selectedEmbeddingModel,
					projectId: projectId,
					onComplete: (doc) => {
						toastState.success(`Embeddings ready for "${doc.name}"`);
						loadProjectData(); // Refresh to show updated status
					},
					onError: (error) => {
						toastState.error(`Embedding failed for "${file.name}": ${error.message}`);
						loadProjectData(); // Refresh to show failed status
					}
				});

				toastState.info(`Added "${file.name}" - generating embeddings...`);
			} catch (error) {
				console.error(`Failed to process ${file.name}:`, error);
				const message = error instanceof Error ? error.message : 'Unknown error';
				toastState.error(`Failed to add "${file.name}": ${message}`);
			}
		}

		// Refresh immediately to show pending documents
		await loadProjectData();
	}

	async function handleDeleteDocument(doc: StoredDocument) {
		if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;

		try {
			await deleteDocument(doc.id);
			toastState.success(`Deleted "${doc.name}"`);
			await loadProjectData();
		} catch {
			toastState.error('Failed to delete document');
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<svelte:head>
	<title>{project?.name || 'Project'} - Vessel</title>
</svelte:head>

{#if project}
	<div class="flex h-full flex-col overflow-hidden bg-theme-primary">
		<!-- Project Header -->
		<div class="border-b border-theme px-6 py-4">
			<div class="mx-auto max-w-4xl">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<!-- Folder icon with project color -->
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-8 w-8"
							viewBox="0 0 20 20"
							fill={project.color || '#10b981'}
						>
							<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
						</svg>
						<div>
							<h1 class="text-xl font-semibold text-theme-primary">{project.name}</h1>
							{#if project.description}
								<p class="text-sm text-theme-muted">{project.description}</p>
							{/if}
						</div>
					</div>

					<div class="flex items-center gap-3">
						<!-- Stats badge -->
						<div class="flex items-center gap-2 rounded-full bg-theme-secondary px-3 py-1.5">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
							</svg>
							<span class="text-sm text-theme-muted">{projectConversations.length} chats</span>
						</div>
						<div class="flex items-center gap-2 rounded-full bg-theme-secondary px-3 py-1.5">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
							</svg>
							<span class="text-sm text-theme-muted">{documents.length} files</span>
						</div>

						<!-- Settings button -->
						<button
							type="button"
							onclick={() => showProjectModal = true}
							class="rounded-lg p-2 text-theme-muted transition-colors hover:bg-theme-secondary hover:text-theme-primary"
							title="Project settings"
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Main Content -->
		<div class="flex-1 overflow-y-auto">
			<div class="mx-auto max-w-4xl px-6 py-6">
				<!-- New Chat Input -->
				<div class="mb-6 rounded-xl border border-theme bg-theme-secondary p-4">
					<textarea
						bind:value={newChatMessage}
						onkeydown={handleKeydown}
						placeholder="New chat in {project.name}"
						rows="2"
						class="w-full resize-none bg-transparent text-theme-primary placeholder-theme-muted focus:outline-none"
					></textarea>
					<div class="mt-3 flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-theme-muted">
							<span>Model: {modelsState.selectedId || 'None selected'}</span>
						</div>
						<button
							type="button"
							onclick={handleCreateChat}
							disabled={!newChatMessage.trim() || isCreatingChat || !modelsState.selectedId}
							class="rounded-full bg-emerald-600 p-2 text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
						>
							{#if isCreatingChat}
								<svg class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
									<path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<!-- Tabs -->
				<div class="mb-4 border-b border-theme">
					<div class="flex gap-6">
						<button
							type="button"
							onclick={() => activeTab = 'chats'}
							class="relative pb-3 text-sm font-medium transition-colors {activeTab === 'chats' ? 'text-emerald-500' : 'text-theme-muted hover:text-theme-primary'}"
						>
							Chats ({projectConversations.length})
							{#if activeTab === 'chats'}
								<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
							{/if}
						</button>
						<button
							type="button"
							onclick={() => activeTab = 'files'}
							class="relative pb-3 text-sm font-medium transition-colors {activeTab === 'files' ? 'text-emerald-500' : 'text-theme-muted hover:text-theme-primary'}"
						>
							Files ({documents.length})
							{#if activeTab === 'files'}
								<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
							{/if}
						</button>
						<button
							type="button"
							onclick={() => activeTab = 'links'}
							class="relative pb-3 text-sm font-medium transition-colors {activeTab === 'links' ? 'text-emerald-500' : 'text-theme-muted hover:text-theme-primary'}"
						>
							Links ({links.length})
							{#if activeTab === 'links'}
								<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
							{/if}
						</button>
					</div>
				</div>

				<!-- Tab Content -->
				{#if activeTab === 'chats'}
					<!-- Search -->
					<div class="mb-4">
						<div class="relative">
							<svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
							</svg>
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Search chats in project..."
								class="w-full rounded-lg border border-theme bg-theme-tertiary py-2 pl-10 pr-4 text-sm text-theme-primary placeholder-theme-muted focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
							/>
						</div>
					</div>

					<!-- Conversations List -->
					{#if filteredConversations.length === 0}
						<div class="py-12 text-center">
							<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto mb-3 h-12 w-12 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
							</svg>
							{#if searchQuery}
								<p class="text-sm text-theme-muted">No chats match your search</p>
							{:else}
								<p class="text-sm text-theme-muted">No chats in this project yet</p>
								<p class="mt-1 text-xs text-theme-muted">Start a new chat above to get started</p>
							{/if}
						</div>
					{:else}
						<div class="space-y-2">
							{#each filteredConversations as conversation (conversation.id)}
								<a
									href="/chat/{conversation.id}"
									class="block rounded-lg border border-theme bg-theme-secondary p-4 transition-colors hover:bg-theme-tertiary"
								>
									<div class="flex items-start justify-between">
										<div class="min-w-0 flex-1">
											<h3 class="truncate font-medium text-theme-primary">
												{conversation.title || 'Untitled'}
											</h3>
											{#if conversation.summary}
												<p class="mt-1 line-clamp-2 text-sm text-theme-muted">
													{conversation.summary}
												</p>
											{/if}
										</div>
										<span class="ml-4 shrink-0 text-xs text-theme-muted">
											{formatDate(conversation.updatedAt)}
										</span>
									</div>
								</a>
							{/each}
						</div>
					{/if}
				{:else if activeTab === 'files'}
					<!-- Embedding Model Selector -->
					<div class="mb-4 flex items-center justify-between">
						<p class="text-sm text-theme-muted">Embedding Model</p>
						<select
							bind:value={selectedEmbeddingModel}
							disabled={isUploading}
							class="rounded-md border border-theme bg-theme-tertiary px-3 py-1.5 text-sm text-theme-primary focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
						>
							{#each EMBEDDING_MODELS as model}
								<option value={model}>{model}</option>
							{/each}
						</select>
					</div>

					<!-- File Upload Zone -->
					<div
						class="mb-4 rounded-xl border-2 border-dashed border-theme p-8 text-center transition-colors {dragOver ? 'border-emerald-500 bg-emerald-500/10' : 'hover:border-emerald-500/50'}"
						ondragover={(e) => { e.preventDefault(); dragOver = true; }}
						ondragleave={() => dragOver = false}
						ondrop={handleDrop}
					>
						<input
							bind:this={fileInput}
							type="file"
							multiple
							accept=".txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.h"
							onchange={handleFileSelect}
							class="hidden"
						/>
						<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto mb-3 h-10 w-10 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
						</svg>
						<p class="text-sm text-theme-muted">
							Drag & drop files here, or
							<button type="button" onclick={() => fileInput.click()} class="text-emerald-500 hover:text-emerald-400">browse</button>
						</p>
						<p class="mt-1 text-xs text-theme-muted">
							Text files, code, markdown, JSON, etc.
						</p>
					</div>

					<!-- Files List -->
					{#if documents.length === 0}
						<div class="py-8 text-center">
							<p class="text-sm text-theme-muted">No files in this project</p>
						</div>
					{:else}
						<div class="space-y-2">
							{#each documents as doc (doc.id)}
								<div class="flex items-center justify-between rounded-lg border border-theme bg-theme-secondary p-3">
									<div class="flex items-center gap-3">
										<!-- Status indicator -->
										{#if doc.embeddingStatus === 'pending' || doc.embeddingStatus === 'processing'}
											<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 animate-spin text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
											</svg>
										{:else if doc.embeddingStatus === 'failed'}
											<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
											</svg>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
											</svg>
										{/if}
										<div>
											<p class="text-sm font-medium text-theme-primary">{doc.name}</p>
											<p class="text-xs text-theme-muted">
												{formatSize(doc.size)}
												{#if doc.embeddingStatus === 'pending'}
													<span class="ml-2 text-yellow-500">• Queued</span>
												{:else if doc.embeddingStatus === 'processing'}
													<span class="ml-2 text-yellow-500">• Generating embeddings...</span>
												{:else if doc.embeddingStatus === 'failed'}
													<span class="ml-2 text-red-500">• Embedding failed</span>
												{/if}
											</p>
										</div>
									</div>
									<button
										type="button"
										onclick={() => handleDeleteDocument(doc)}
										class="rounded p-1.5 text-theme-muted transition-colors hover:bg-red-900/30 hover:text-red-400"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
										</svg>
									</button>
								</div>
							{/each}
						</div>
					{/if}
				{:else if activeTab === 'links'}
					<!-- Links List -->
					{#if links.length === 0}
						<div class="py-12 text-center">
							<svg xmlns="http://www.w3.org/2000/svg" class="mx-auto mb-3 h-10 w-10 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
							</svg>
							<p class="text-sm text-theme-muted">No reference links</p>
							<p class="mt-1 text-xs text-theme-muted">Add links in project settings</p>
							<button
								type="button"
								onclick={() => showProjectModal = true}
								class="mt-3 text-sm text-emerald-500 hover:text-emerald-400"
							>
								Open settings
							</button>
						</div>
					{:else}
						<div class="space-y-2">
							{#each links as link (link.id)}
								<a
									href={link.url}
									target="_blank"
									rel="noopener noreferrer"
									class="block rounded-lg border border-theme bg-theme-secondary p-4 transition-colors hover:bg-theme-tertiary"
								>
									<div class="flex items-start gap-3">
										<svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
										</svg>
										<div class="min-w-0 flex-1">
											<p class="font-medium text-theme-primary">{link.title}</p>
											{#if link.description}
												<p class="mt-0.5 text-sm text-theme-muted">{link.description}</p>
											{/if}
											<p class="mt-1 truncate text-xs text-emerald-500">{link.url}</p>
										</div>
									</div>
								</a>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{:else}
	<!-- Loading / Not Found -->
	<div class="flex h-full items-center justify-center">
		<div class="text-center">
			<p class="text-theme-muted">Loading project...</p>
		</div>
	</div>
{/if}

<!-- Project Modal -->
<ProjectModal
	isOpen={showProjectModal}
	onClose={() => showProjectModal = false}
	{projectId}
/>
