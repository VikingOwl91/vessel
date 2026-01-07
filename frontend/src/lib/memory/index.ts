/**
 * Memory management module exports
 */

// Types
export * from './types.js';

// Tokenizer utilities
export {
	estimateTokens,
	estimateTokensFromChars,
	estimateTokensFromWords,
	estimateMessageTokens,
	estimateImageTokens,
	estimateConversationTokens,
	estimateFormatOverhead,
	formatTokenCount
} from './tokenizer.js';

// Model limits
export {
	getModelContextLimit,
	modelSupportsTools,
	modelSupportsVision,
	formatContextSize
} from './model-limits.js';

// Context manager
export {
	contextManager,
	getContextUsageColor,
	getProgressBarColor
} from './context-manager.svelte.js';

// Summarization
export {
	generateSummary,
	selectMessagesForSummarization,
	calculateTokenSavings,
	createSummaryRecord,
	shouldSummarize,
	formatSummaryAsContext
} from './summarizer.js';

// Embeddings
export {
	generateEmbedding,
	generateEmbeddings,
	cosineSimilarity,
	findSimilar,
	normalizeVector,
	getEmbeddingDimension,
	DEFAULT_EMBEDDING_MODEL,
	PREFERRED_EMBEDDING_MODEL,
	FALLBACK_EMBEDDING_MODEL,
	EMBEDDING_MODELS
} from './embeddings.js';

// Chunking
export {
	chunkText,
	splitByParagraphs,
	splitBySentences,
	estimateChunkTokens,
	mergeSmallChunks,
	type ChunkOptions
} from './chunker.js';

// Vector store
export {
	addDocument,
	addDocumentAsync,
	searchSimilar,
	listDocuments,
	getDocument,
	getDocumentChunks,
	deleteDocument,
	getKnowledgeBaseStats,
	formatResultsAsContext,
	type SearchResult,
	type AddDocumentOptions,
	type AddDocumentAsyncOptions
} from './vector-store.js';
