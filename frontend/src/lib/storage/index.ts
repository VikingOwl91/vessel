/**
 * Storage layer exports
 * IndexedDB-based local storage using Dexie.js
 */

// Database setup and types
export { db, generateId, withErrorHandling } from './db.js';
export type {
	StoredConversation,
	StoredMessage,
	StoredAttachment,
	SyncQueueItem,
	StoredPrompt,
	StoredAgent,
	StoredProjectAgent,
	StorageResult
} from './db.js';

// Conversation operations
export {
	getAllConversations,
	getArchivedConversations,
	getConversation,
	getConversationFull,
	createConversation,
	updateConversation,
	deleteConversation,
	pinConversation,
	archiveConversation,
	updateMessageCount,
	updateSystemPrompt,
	updateAgentId,
	searchConversations
} from './conversations.js';

// Message operations
export {
	getMessagesForConversation,
	getMessage,
	addMessage,
	updateMessage,
	deleteMessage,
	deleteMessagesForConversation,
	getMessageTree,
	getSiblings,
	getPathToMessage,
	appendToMessage,
	searchMessages
} from './messages.js';
export type { MessageSearchResult } from './messages.js';

// Attachment operations
export {
	// Query
	getAttachmentsForMessage,
	getAttachmentMetaForMessage,
	getAttachment,
	getAttachmentsByIds,
	getAttachmentMetaByIds,
	// Create
	saveAttachment,
	saveAttachments,
	addAttachmentFromBlob,
	// Update
	updateAttachmentAnalysis,
	// Delete
	deleteAttachment,
	deleteAttachmentsForMessage,
	deleteAttachmentsByIds,
	// Data conversion
	getAttachmentDataUrl,
	getAttachmentBase64,
	getAttachmentTextContent,
	createDownloadUrl,
	// Statistics
	getTotalAttachmentSize,
	getConversationAttachmentSize,
	getAttachmentCountForMessage
} from './attachments.js';
export type { AttachmentMeta } from './attachments.js';

// Sync utilities
export {
	markForSync,
	getPendingSyncItems,
	getPendingSyncItemsByType,
	clearSyncItem,
	clearSyncItems,
	incrementRetryCount,
	clearAllSyncItems,
	getPendingSyncCount,
	hasPendingSyncs,
	markMultipleForSync
} from './sync.js';
export type { SyncEntityType, SyncOperation } from './sync.js';

// Prompt operations
export {
	getAllPrompts,
	getDefaultPrompt,
	getPrompt,
	createPrompt,
	updatePrompt,
	deletePrompt,
	setDefaultPrompt,
	clearDefaultPrompt,
	searchPrompts
} from './prompts.js';

// Agent operations
export {
	getAllAgents,
	getAgent,
	createAgent,
	updateAgent,
	deleteAgent,
	assignAgentToProject,
	removeAgentFromProject,
	getAgentsForProject,
	getProjectsForAgent
} from './agents.js';
export type { Agent, CreateAgentData, UpdateAgentData } from './agents.js';
