/**
 * Vector store for knowledge base documents
 *
 * Stores document chunks with embeddings in IndexedDB
 * and provides similarity search for RAG retrieval.
 */

import { db, type StoredDocument, type StoredChunk } from '$lib/storage/db.js';
import { generateEmbedding, generateEmbeddings, cosineSimilarity, DEFAULT_EMBEDDING_MODEL } from './embeddings.js';
import { chunkText, estimateChunkTokens, type ChunkOptions } from './chunker.js';

/** Result of a similarity search */
export interface SearchResult {
	chunk: StoredChunk;
	document: StoredDocument;
	similarity: number;
}

/** Options for adding a document */
export interface AddDocumentOptions {
	/** Chunking options */
	chunkOptions?: ChunkOptions;
	/** Embedding model to use */
	embeddingModel?: string;
	/** Callback for progress updates */
	onProgress?: (current: number, total: number) => void;
	/** Project ID if document belongs to a project */
	projectId?: string;
}

/**
 * Add a document to the knowledge base
 * Chunks the content and generates embeddings for each chunk
 */
export async function addDocument(
	name: string,
	content: string,
	mimeType: string,
	options: AddDocumentOptions = {}
): Promise<StoredDocument> {
	const {
		chunkOptions,
		embeddingModel = DEFAULT_EMBEDDING_MODEL,
		onProgress,
		projectId
	} = options;

	const documentId = crypto.randomUUID();
	const now = Date.now();

	// Chunk the content
	const textChunks = chunkText(content, documentId, chunkOptions);

	if (textChunks.length === 0) {
		throw new Error('Document produced no chunks');
	}

	// Generate embeddings for all chunks
	const chunkContents = textChunks.map(c => c.content);
	const embeddings: number[][] = [];

	// Process in batches with progress
	const BATCH_SIZE = 5;
	for (let i = 0; i < chunkContents.length; i += BATCH_SIZE) {
		const batch = chunkContents.slice(i, i + BATCH_SIZE);
		const batchEmbeddings = await generateEmbeddings(batch, embeddingModel);
		embeddings.push(...batchEmbeddings);

		if (onProgress) {
			onProgress(Math.min(i + BATCH_SIZE, chunkContents.length), chunkContents.length);
		}
	}

	// Create stored chunks with embeddings
	const storedChunks: StoredChunk[] = textChunks.map((chunk, index) => ({
		id: chunk.id,
		documentId,
		content: chunk.content,
		embedding: embeddings[index],
		startIndex: chunk.startIndex,
		endIndex: chunk.endIndex,
		tokenCount: estimateChunkTokens(chunk.content)
	}));

	// Create document record
	const document: StoredDocument = {
		id: documentId,
		name,
		mimeType,
		size: content.length,
		createdAt: now,
		updatedAt: now,
		chunkCount: storedChunks.length,
		embeddingModel,
		projectId: projectId ?? null,
		embeddingStatus: 'ready'
	};

	// Store in database
	await db.transaction('rw', [db.documents, db.chunks], async () => {
		await db.documents.add(document);
		await db.chunks.bulkAdd(storedChunks);
	});

	return document;
}

/** Options for async document upload */
export interface AddDocumentAsyncOptions extends AddDocumentOptions {
	/** Callback when embedding generation completes */
	onComplete?: (doc: StoredDocument) => void;
	/** Callback when embedding generation fails */
	onError?: (error: Error) => void;
}

/**
 * Add a document asynchronously - stores immediately, generates embeddings in background
 * Returns immediately with the document in 'pending' state
 */
export async function addDocumentAsync(
	name: string,
	content: string,
	mimeType: string,
	options: AddDocumentAsyncOptions = {}
): Promise<StoredDocument> {
	const {
		chunkOptions,
		embeddingModel = DEFAULT_EMBEDDING_MODEL,
		onProgress,
		onComplete,
		onError,
		projectId
	} = options;

	const documentId = crypto.randomUUID();
	const now = Date.now();

	// Chunk the content
	const textChunks = chunkText(content, documentId, chunkOptions);

	if (textChunks.length === 0) {
		throw new Error('Document produced no chunks');
	}

	// Create document record immediately (without embeddings)
	const document: StoredDocument = {
		id: documentId,
		name,
		mimeType,
		size: content.length,
		createdAt: now,
		updatedAt: now,
		chunkCount: textChunks.length,
		embeddingModel,
		projectId: projectId ?? null,
		embeddingStatus: 'pending'
	};

	// Store document immediately
	await db.documents.add(document);

	// Generate embeddings in background (non-blocking)
	setTimeout(async () => {
		try {
			// Update status to processing
			await db.documents.update(documentId, { embeddingStatus: 'processing' });

			const chunkContents = textChunks.map(c => c.content);
			const embeddings: number[][] = [];

			// Process in batches with progress
			const BATCH_SIZE = 5;
			for (let i = 0; i < chunkContents.length; i += BATCH_SIZE) {
				const batch = chunkContents.slice(i, i + BATCH_SIZE);
				const batchEmbeddings = await generateEmbeddings(batch, embeddingModel);
				embeddings.push(...batchEmbeddings);

				if (onProgress) {
					onProgress(Math.min(i + BATCH_SIZE, chunkContents.length), chunkContents.length);
				}
			}

			// Create stored chunks with embeddings
			const storedChunks: StoredChunk[] = textChunks.map((chunk, index) => ({
				id: chunk.id,
				documentId,
				content: chunk.content,
				embedding: embeddings[index],
				startIndex: chunk.startIndex,
				endIndex: chunk.endIndex,
				tokenCount: estimateChunkTokens(chunk.content)
			}));

			// Store chunks and update document status
			await db.transaction('rw', [db.documents, db.chunks], async () => {
				await db.chunks.bulkAdd(storedChunks);
				await db.documents.update(documentId, {
					embeddingStatus: 'ready',
					updatedAt: Date.now()
				});
			});

			const updatedDoc = await db.documents.get(documentId);
			if (updatedDoc && onComplete) {
				onComplete(updatedDoc);
			}
		} catch (error) {
			console.error('Failed to generate embeddings:', error);
			await db.documents.update(documentId, { embeddingStatus: 'failed' });
			if (onError) {
				onError(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}, 0);

	return document;
}

/**
 * Search for similar chunks across all documents
 */
export async function searchSimilar(
	query: string,
	topK: number = 5,
	threshold: number = 0.5,
	embeddingModel: string = DEFAULT_EMBEDDING_MODEL
): Promise<SearchResult[]> {
	// Generate embedding for query
	const queryEmbedding = await generateEmbedding(query, embeddingModel);

	// Get all chunks (for small collections, this is fine)
	// For larger collections, we'd want to implement approximate NN search
	const allChunks = await db.chunks.toArray();

	if (allChunks.length === 0) {
		return [];
	}

	// Calculate similarities
	const scored = allChunks.map(chunk => ({
		chunk,
		similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
	}));

	// Filter and sort
	const filtered = scored
		.filter(item => item.similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, topK);

	// Fetch document info for results
	const documentIds = [...new Set(filtered.map(r => r.chunk.documentId))];
	const documents = await db.documents.bulkGet(documentIds);
	const documentMap = new Map(documents.filter(Boolean).map(d => [d!.id, d!]));

	// Build results
	return filtered
		.map(item => ({
			chunk: item.chunk,
			document: documentMap.get(item.chunk.documentId)!,
			similarity: item.similarity
		}))
		.filter(r => r.document !== undefined);
}

/**
 * Get all documents in the knowledge base
 */
export async function listDocuments(): Promise<StoredDocument[]> {
	return db.documents.orderBy('updatedAt').reverse().toArray();
}

/**
 * Get a document by ID
 */
export async function getDocument(id: string): Promise<StoredDocument | undefined> {
	return db.documents.get(id);
}

/**
 * Get all chunks for a document
 */
export async function getDocumentChunks(documentId: string): Promise<StoredChunk[]> {
	return db.chunks.where('documentId').equals(documentId).toArray();
}

/**
 * Delete a document and its chunks
 */
export async function deleteDocument(id: string): Promise<void> {
	await db.transaction('rw', [db.documents, db.chunks], async () => {
		await db.chunks.where('documentId').equals(id).delete();
		await db.documents.delete(id);
	});
}

/**
 * Get total statistics for the knowledge base
 */
export async function getKnowledgeBaseStats(): Promise<{
	documentCount: number;
	chunkCount: number;
	totalTokens: number;
}> {
	const documents = await db.documents.count();
	const chunks = await db.chunks.toArray();

	return {
		documentCount: documents,
		chunkCount: chunks.length,
		totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0)
	};
}

/**
 * Format search results as context for the LLM
 */
export function formatResultsAsContext(results: SearchResult[]): string {
	if (results.length === 0) {
		return '';
	}

	const sections = results.map((r, i) => {
		const source = r.document.name;
		return `[Source ${i + 1}: ${source}]\n${r.chunk.content}`;
	});

	return `Relevant context from knowledge base:\n\n${sections.join('\n\n---\n\n')}`;
}
