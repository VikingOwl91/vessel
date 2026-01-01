/**
 * Conversation CRUD operations for IndexedDB storage
 */

import { db, withErrorHandling, generateId } from './db.js';
import type { StoredConversation, StorageResult } from './db.js';
import type { Conversation, ConversationFull, MessageNode } from '../types/index.js';
import { getMessagesForConversation, getMessageTree, deleteMessagesForConversation } from './messages.js';
import { markForSync } from './sync.js';

/**
 * Converts stored conversation to domain type
 */
function toDomainConversation(stored: StoredConversation): Conversation {
	return {
		id: stored.id,
		title: stored.title,
		model: stored.model,
		createdAt: new Date(stored.createdAt),
		updatedAt: new Date(stored.updatedAt),
		isPinned: stored.isPinned,
		isArchived: stored.isArchived,
		messageCount: stored.messageCount,
		systemPromptId: stored.systemPromptId ?? null
	};
}

/**
 * Converts domain conversation to stored type
 */
function toStoredConversation(
	conversation: Omit<Conversation, 'createdAt' | 'updatedAt'> & {
		createdAt?: Date;
		updatedAt?: Date;
	}
): StoredConversation {
	const now = Date.now();
	return {
		id: conversation.id,
		title: conversation.title,
		model: conversation.model,
		createdAt: conversation.createdAt?.getTime() ?? now,
		updatedAt: conversation.updatedAt?.getTime() ?? now,
		isPinned: conversation.isPinned,
		isArchived: conversation.isArchived,
		messageCount: conversation.messageCount,
		systemPromptId: conversation.systemPromptId ?? null
	};
}

/**
 * Get all non-archived conversations, sorted by updatedAt descending
 * Pinned conversations are returned first
 */
export async function getAllConversations(): Promise<StorageResult<Conversation[]>> {
	return withErrorHandling(async () => {
		const all = await db.conversations.toArray();
		const filtered = all.filter((c) => !c.isArchived);

		// Sort: pinned first, then by updatedAt descending
		const sorted = filtered.sort((a, b) => {
			if (a.isPinned && !b.isPinned) return -1;
			if (!a.isPinned && b.isPinned) return 1;
			return b.updatedAt - a.updatedAt;
		});

		return sorted.map(toDomainConversation);
	});
}

/**
 * Get archived conversations, sorted by updatedAt descending
 */
export async function getArchivedConversations(): Promise<StorageResult<Conversation[]>> {
	return withErrorHandling(async () => {
		const all = await db.conversations.toArray();
		const archived = all.filter((c) => c.isArchived);

		const sorted = archived.sort((a, b) => b.updatedAt - a.updatedAt);
		return sorted.map(toDomainConversation);
	});
}

/**
 * Get a single conversation by ID (metadata only)
 */
export async function getConversation(id: string): Promise<StorageResult<Conversation | null>> {
	return withErrorHandling(async () => {
		const stored = await db.conversations.get(id);
		return stored ? toDomainConversation(stored) : null;
	});
}

/**
 * Get a full conversation including all messages
 */
export async function getConversationFull(id: string): Promise<StorageResult<ConversationFull | null>> {
	return withErrorHandling(async () => {
		const stored = await db.conversations.get(id);
		if (!stored) {
			return null;
		}

		const messagesResult = await getMessagesForConversation(id);
		if (!messagesResult.success) {
			throw new Error((messagesResult as { success: false; error: string }).error);
		}

		const treeResult = await getMessageTree(id);
		if (!treeResult.success) {
			throw new Error((treeResult as { success: false; error: string }).error);
		}

		const { rootMessageId, activePath } = treeResult.data;

		return {
			...toDomainConversation(stored),
			messages: messagesResult.data,
			activePath,
			rootMessageId
		};
	});
}

/**
 * Create a new conversation
 */
export async function createConversation(
	data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt' | 'messageCount'>
): Promise<StorageResult<Conversation>> {
	return withErrorHandling(async () => {
		const id = generateId();
		const now = Date.now();

		const stored: StoredConversation = {
			id,
			title: data.title,
			model: data.model,
			createdAt: now,
			updatedAt: now,
			isPinned: data.isPinned ?? false,
			isArchived: data.isArchived ?? false,
			messageCount: 0,
			syncVersion: 1,
			systemPromptId: data.systemPromptId ?? null
		};

		await db.conversations.add(stored);

		// Queue for backend sync
		await markForSync('conversation', id, 'create');

		return toDomainConversation(stored);
	});
}

/**
 * Update conversation metadata
 */
export async function updateConversation(
	id: string,
	data: Partial<Omit<StoredConversation, 'id' | 'createdAt'>>
): Promise<StorageResult<Conversation>> {
	return withErrorHandling(async () => {
		const existing = await db.conversations.get(id);
		if (!existing) {
			throw new Error(`Conversation not found: ${id}`);
		}

		const updated: StoredConversation = {
			...existing,
			...data,
			updatedAt: Date.now(),
			syncVersion: (existing.syncVersion ?? 0) + 1
		};

		await db.conversations.put(updated);

		// Queue for backend sync
		await markForSync('conversation', id, 'update');

		return toDomainConversation(updated);
	});
}

/**
 * Delete a conversation and all its messages and attachments
 */
export async function deleteConversation(id: string): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		await db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
			// Delete all attachments for messages in this conversation
			const messages = await db.messages.where('conversationId').equals(id).toArray();
			const messageIds = messages.map((m) => m.id);

			if (messageIds.length > 0) {
				await db.attachments.where('messageId').anyOf(messageIds).delete();
			}

			// Delete all messages
			await deleteMessagesForConversation(id);

			// Delete the conversation
			await db.conversations.delete(id);
		});

		// Queue for backend sync (after transaction completes)
		await markForSync('conversation', id, 'delete');
	});
}

/**
 * Toggle pin status for a conversation
 */
export async function pinConversation(id: string): Promise<StorageResult<Conversation>> {
	return withErrorHandling(async () => {
		const existing = await db.conversations.get(id);
		if (!existing) {
			throw new Error(`Conversation not found: ${id}`);
		}

		const updated: StoredConversation = {
			...existing,
			isPinned: !existing.isPinned,
			updatedAt: Date.now(),
			syncVersion: (existing.syncVersion ?? 0) + 1
		};

		await db.conversations.put(updated);

		// Queue for backend sync
		await markForSync('conversation', id, 'update');

		return toDomainConversation(updated);
	});
}

/**
 * Archive a conversation (or unarchive if already archived)
 */
export async function archiveConversation(id: string): Promise<StorageResult<Conversation>> {
	return withErrorHandling(async () => {
		const existing = await db.conversations.get(id);
		if (!existing) {
			throw new Error(`Conversation not found: ${id}`);
		}

		const updated: StoredConversation = {
			...existing,
			isArchived: !existing.isArchived,
			updatedAt: Date.now(),
			syncVersion: (existing.syncVersion ?? 0) + 1
		};

		await db.conversations.put(updated);

		// Queue for backend sync
		await markForSync('conversation', id, 'update');

		return toDomainConversation(updated);
	});
}

/**
 * Update the message count for a conversation
 * Called internally when messages are added or removed
 */
export async function updateMessageCount(
	conversationId: string,
	delta: number
): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		const existing = await db.conversations.get(conversationId);
		if (!existing) {
			throw new Error(`Conversation not found: ${conversationId}`);
		}

		await db.conversations.update(conversationId, {
			messageCount: Math.max(0, existing.messageCount + delta),
			updatedAt: Date.now()
		});
	});
}

/**
 * Update the system prompt for a conversation
 */
export async function updateSystemPrompt(
	conversationId: string,
	systemPromptId: string | null
): Promise<StorageResult<Conversation>> {
	return updateConversation(conversationId, { systemPromptId });
}

/**
 * Search conversations by title
 */
export async function searchConversations(query: string): Promise<StorageResult<Conversation[]>> {
	return withErrorHandling(async () => {
		const lowerQuery = query.toLowerCase();
		const all = await db.conversations.toArray();

		const matching = all
			.filter((c) => !c.isArchived && c.title.toLowerCase().includes(lowerQuery))
			.sort((a, b) => {
				if (a.isPinned && !b.isPinned) return -1;
				if (!a.isPinned && b.isPinned) return 1;
				return b.updatedAt - a.updatedAt;
			});

		return matching.map(toDomainConversation);
	});
}
