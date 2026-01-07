/**
 * IndexedDB database setup using Dexie.js
 * Provides local storage for conversations, messages, and attachments
 */

import Dexie, { type Table } from 'dexie';

/**
 * Stored conversation metadata
 * Uses timestamps as numbers for IndexedDB compatibility
 */
export interface StoredConversation {
	id: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	isPinned: boolean;
	isArchived: boolean;
	messageCount: number;
	syncVersion?: number;
	/** Optional system prompt ID for this conversation */
	systemPromptId?: string | null;
	/** Optional project ID this conversation belongs to */
	projectId?: string | null;
	/** Auto-generated conversation summary for cross-chat context */
	summary?: string | null;
	/** Timestamp when summary was last updated */
	summaryUpdatedAt?: number | null;
}

/**
 * Conversation record with Date objects (for sync manager)
 */
export interface ConversationRecord {
	id: string;
	title: string;
	model: string;
	createdAt: Date;
	updatedAt: Date;
	isPinned: boolean;
	isArchived: boolean;
	messageCount: number;
	syncVersion?: number;
	/** Optional system prompt ID for this conversation */
	systemPromptId?: string | null;
	/** Optional project ID this conversation belongs to */
	projectId?: string | null;
	/** Auto-generated conversation summary for cross-chat context */
	summary?: string | null;
	/** Timestamp when summary was last updated */
	summaryUpdatedAt?: Date | null;
}

/**
 * Stored message in a conversation
 * Flattened structure for efficient storage and retrieval
 */
export interface StoredMessage {
	id: string;
	conversationId: string;
	parentId: string | null;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	images?: string[];
	toolCalls?: Array<{
		id: string;
		name: string;
		arguments: string;
	}>;
	siblingIndex: number;
	createdAt: number;
	syncVersion?: number;
	/** References to attachments stored in the attachments table */
	attachmentIds?: string[];
}

/**
 * Message record with Date objects (for sync manager)
 */
export interface MessageRecord {
	id: string;
	conversationId: string;
	parentId: string | null;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	images?: string[];
	createdAt: Date;
	syncVersion?: number;
}

/**
 * Stored attachment for a message
 * Binary data stored as Blob for efficiency
 */
export interface StoredAttachment {
	id: string;
	messageId: string;
	mimeType: string;
	data: Blob;
	filename: string;
	/** File size in bytes */
	size: number;
	/** Attachment type category */
	type: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'binary';
	/** Timestamp when attachment was created */
	createdAt: number;
	/** Cached extracted text (for text/PDF files) */
	textContent?: string;
	/** Whether the text content was truncated */
	truncated?: boolean;
	/** Whether this attachment was analyzed by the file analyzer */
	analyzed?: boolean;
	/** Summary from file analyzer (if analyzed) */
	summary?: string;
}

/**
 * Attachment metadata (without the binary data)
 * Used for displaying attachment info without loading the full blob
 */
export interface AttachmentMeta {
	id: string;
	messageId: string;
	filename: string;
	mimeType: string;
	size: number;
	type: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'binary';
	createdAt: number;
	truncated?: boolean;
	analyzed?: boolean;
}

/**
 * Sync queue item for future backend synchronization
 */
export interface SyncQueueItem {
	id: string;
	entityType: 'conversation' | 'message' | 'attachment';
	entityId: string;
	operation: 'create' | 'update' | 'delete';
	createdAt: number;
	retryCount: number;
}

/**
 * Knowledge base document (for RAG)
 */
export interface StoredDocument {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	createdAt: number;
	updatedAt: number;
	chunkCount: number;
	embeddingModel: string;
	/** Optional project ID - if set, document is project-scoped */
	projectId?: string | null;
	/** Embedding generation status: 'pending' | 'processing' | 'ready' | 'failed' */
	embeddingStatus?: 'pending' | 'processing' | 'ready' | 'failed';
}

/**
 * Document chunk with embedding (for RAG)
 */
export interface StoredChunk {
	id: string;
	documentId: string;
	content: string;
	embedding: number[];
	startIndex: number;
	endIndex: number;
	tokenCount: number;
}

/**
 * System prompt template
 */
export interface StoredPrompt {
	id: string;
	name: string;
	content: string;
	description: string;
	isDefault: boolean;
	createdAt: number;
	updatedAt: number;
	/** Capabilities this prompt is optimized for (for auto-matching) */
	targetCapabilities?: string[];
}

/**
 * Cached model info including embedded system prompt (from Ollama /api/show)
 */
export interface StoredModelSystemPrompt {
	/** Model name (e.g., "llama3.2:8b") - Primary key */
	modelName: string;
	/** System prompt extracted from modelfile, null if none */
	systemPrompt: string | null;
	/** Model capabilities (vision, code, thinking, tools, etc.) */
	capabilities: string[];
	/** Timestamp when this info was fetched */
	extractedAt: number;
}

/**
 * User-configured model-to-prompt mapping
 * Allows users to set default prompts for specific models
 */
export interface StoredModelPromptMapping {
	id: string;
	/** Ollama model name (e.g., "llama3.2:8b") */
	modelName: string;
	/** Reference to StoredPrompt.id */
	promptId: string;
	createdAt: number;
	updatedAt: number;
}

// ============================================================================
// Project-related interfaces (v6)
// ============================================================================

/**
 * Project for organizing conversations with shared context
 */
export interface StoredProject {
	id: string;
	name: string;
	description: string;
	/** Instructions injected into system prompt for all project chats */
	instructions: string;
	/** Hex color for UI display */
	color: string;
	/** Whether folder is collapsed in sidebar */
	isCollapsed: boolean;
	createdAt: number;
	updatedAt: number;
}

/**
 * Reference link attached to a project
 */
export interface StoredProjectLink {
	id: string;
	projectId: string;
	url: string;
	title: string;
	description: string;
	createdAt: number;
}

/**
 * Chat message chunk with embedding for cross-chat RAG
 * Enables searching across conversation history within a project
 */
export interface StoredChatChunk {
	id: string;
	conversationId: string;
	/** Denormalized for efficient project-scoped queries */
	projectId: string;
	messageId: string;
	role: 'user' | 'assistant';
	content: string;
	embedding: number[];
	createdAt: number;
}

/**
 * Ollama WebUI database class
 * Manages all local storage tables
 */
class OllamaDatabase extends Dexie {
	conversations!: Table<StoredConversation>;
	messages!: Table<StoredMessage>;
	attachments!: Table<StoredAttachment>;
	syncQueue!: Table<SyncQueueItem>;
	documents!: Table<StoredDocument>;
	chunks!: Table<StoredChunk>;
	prompts!: Table<StoredPrompt>;
	modelSystemPrompts!: Table<StoredModelSystemPrompt>;
	modelPromptMappings!: Table<StoredModelPromptMapping>;
	// Project-related tables (v6)
	projects!: Table<StoredProject>;
	projectLinks!: Table<StoredProjectLink>;
	chatChunks!: Table<StoredChatChunk>;

	constructor() {
		super('vessel');

		// Version 1: Core chat functionality
		this.version(1).stores({
			// Primary key: id, Indexes: updatedAt, isPinned, isArchived
			conversations: 'id, updatedAt, isPinned, isArchived',
			// Primary key: id, Indexes: conversationId, parentId, createdAt
			messages: 'id, conversationId, parentId, createdAt',
			// Primary key: id, Index: messageId
			attachments: 'id, messageId',
			// Primary key: id, Indexes: entityType, createdAt
			syncQueue: 'id, entityType, createdAt'
		});

		// Version 2: Knowledge base / RAG support
		this.version(2).stores({
			conversations: 'id, updatedAt, isPinned, isArchived',
			messages: 'id, conversationId, parentId, createdAt',
			attachments: 'id, messageId',
			syncQueue: 'id, entityType, createdAt',
			// Knowledge base documents
			documents: 'id, name, createdAt, updatedAt',
			// Document chunks with embeddings
			chunks: 'id, documentId'
		});

		// Version 3: System prompts
		this.version(3).stores({
			conversations: 'id, updatedAt, isPinned, isArchived',
			messages: 'id, conversationId, parentId, createdAt',
			attachments: 'id, messageId',
			syncQueue: 'id, entityType, createdAt',
			documents: 'id, name, createdAt, updatedAt',
			chunks: 'id, documentId',
			// System prompt templates
			prompts: 'id, name, isDefault, updatedAt'
		});

		// Version 4: Per-conversation system prompts
		// Note: No schema change needed - just adding optional field to conversations
		// Dexie handles this gracefully (field is undefined on old records)
		this.version(4).stores({
			conversations: 'id, updatedAt, isPinned, isArchived, systemPromptId',
			messages: 'id, conversationId, parentId, createdAt',
			attachments: 'id, messageId',
			syncQueue: 'id, entityType, createdAt',
			documents: 'id, name, createdAt, updatedAt',
			chunks: 'id, documentId',
			prompts: 'id, name, isDefault, updatedAt'
		});

		// Version 5: Model-specific system prompts
		// Adds: cached model info (with embedded prompts) and user model-prompt mappings
		this.version(5).stores({
			conversations: 'id, updatedAt, isPinned, isArchived, systemPromptId',
			messages: 'id, conversationId, parentId, createdAt',
			attachments: 'id, messageId',
			syncQueue: 'id, entityType, createdAt',
			documents: 'id, name, createdAt, updatedAt',
			chunks: 'id, documentId',
			prompts: 'id, name, isDefault, updatedAt',
			// Cached model info from Ollama /api/show (includes embedded system prompts)
			modelSystemPrompts: 'modelName',
			// User-configured model-to-prompt mappings
			modelPromptMappings: 'id, modelName, promptId'
		});

		// Version 6: Projects with cross-chat context sharing
		// Adds: projects, project links, chat chunks for RAG, projectId on conversations/documents
		this.version(6).stores({
			// Add projectId index for filtering conversations by project
			conversations: 'id, updatedAt, isPinned, isArchived, systemPromptId, projectId',
			messages: 'id, conversationId, parentId, createdAt',
			attachments: 'id, messageId',
			syncQueue: 'id, entityType, createdAt',
			// Add projectId index for project-scoped document RAG
			documents: 'id, name, createdAt, updatedAt, projectId',
			chunks: 'id, documentId',
			prompts: 'id, name, isDefault, updatedAt',
			modelSystemPrompts: 'modelName',
			modelPromptMappings: 'id, modelName, promptId',
			// Projects for organizing conversations
			projects: 'id, name, createdAt, updatedAt',
			// Reference links attached to projects
			projectLinks: 'id, projectId, createdAt',
			// Chat message chunks for cross-conversation RAG within projects
			chatChunks: 'id, conversationId, projectId, createdAt'
		});
	}
}

/**
 * Singleton database instance
 */
export const db = new OllamaDatabase();

/**
 * Result type for database operations
 * Provides consistent error handling across all storage functions
 */
export type StorageResult<T> =
	| { success: true; data: T }
	| { success: false; error: string };

/**
 * Wraps a database operation with error handling
 * @param operation - Async function to execute
 * @returns StorageResult with data or error
 */
export async function withErrorHandling<T>(
	operation: () => Promise<T>
): Promise<StorageResult<T>> {
	try {
		const data = await operation();
		return { success: true, data };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown database error';
		console.error('[Storage Error]', message, error);
		return { success: false, error: message };
	}
}

/**
 * Generates a unique ID for database entities
 * Uses crypto.randomUUID for guaranteed uniqueness
 */
export function generateId(): string {
	return crypto.randomUUID();
}
