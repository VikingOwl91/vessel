/**
 * Message operations for IndexedDB storage
 * Handles message CRUD and tree structure management
 */

import { db, withErrorHandling, generateId } from './db.js';
import type { StoredMessage, StorageResult } from './db.js';
import type { Message, MessageNode, BranchPath } from '../types/index.js';
import { markForSync } from './sync.js';

/**
 * Converts stored message to MessageNode domain type
 */
function toMessageNode(stored: StoredMessage, childIds: string[]): MessageNode {
	return {
		id: stored.id,
		message: {
			role: stored.role,
			content: stored.content,
			images: stored.images,
			toolCalls: stored.toolCalls
		},
		parentId: stored.parentId,
		childIds,
		createdAt: new Date(stored.createdAt)
	};
}

/**
 * Get all messages for a conversation as a Map
 * Builds the full tree structure with child relationships
 */
export async function getMessagesForConversation(
	conversationId: string
): Promise<StorageResult<Map<string, MessageNode>>> {
	return withErrorHandling(async () => {
		const stored = await db.messages
			.where('conversationId')
			.equals(conversationId)
			.toArray();

		// Build child relationships
		const childrenMap = new Map<string, string[]>();

		for (const msg of stored) {
			if (msg.parentId) {
				const siblings = childrenMap.get(msg.parentId) ?? [];
				siblings.push(msg.id);
				childrenMap.set(msg.parentId, siblings);
			}
		}

		// Sort children by siblingIndex
		Array.from(childrenMap.entries()).forEach(([parentId, children]) => {
			const parentMessages = stored.filter((m) => children.includes(m.id));
			parentMessages.sort((a, b) => a.siblingIndex - b.siblingIndex);
			childrenMap.set(
				parentId,
				parentMessages.map((m) => m.id)
			);
		});

		// Convert to MessageNode map
		const result = new Map<string, MessageNode>();
		for (const msg of stored) {
			const childIds = childrenMap.get(msg.id) ?? [];
			result.set(msg.id, toMessageNode(msg, childIds));
		}

		return result;
	});
}

/**
 * Get a single message by ID
 */
export async function getMessage(id: string): Promise<StorageResult<MessageNode | null>> {
	return withErrorHandling(async () => {
		const stored = await db.messages.get(id);
		if (!stored) {
			return null;
		}

		// Get children
		const children = await db.messages
			.where('parentId')
			.equals(id)
			.sortBy('siblingIndex');

		return toMessageNode(
			stored,
			children.map((c) => c.id)
		);
	});
}

/**
 * Add a new message to a conversation
 * Returns the created message node
 */
export async function addMessage(
	conversationId: string,
	message: Message,
	parentId: string | null = null,
	messageId?: string
): Promise<StorageResult<MessageNode>> {
	return withErrorHandling(async () => {
		const id = messageId ?? generateId();
		const now = Date.now();

		// Calculate sibling index
		let siblingIndex = 0;
		if (parentId) {
			const siblings = await db.messages.where('parentId').equals(parentId).count();
			siblingIndex = siblings;
		} else {
			// Root messages - count existing roots for this conversation
			const roots = await db.messages
				.where('conversationId')
				.equals(conversationId)
				.filter((m) => m.parentId === null)
				.count();
			siblingIndex = roots;
		}

		const stored: StoredMessage = {
			id,
			conversationId,
			parentId,
			role: message.role,
			content: message.content,
			images: message.images,
			toolCalls: message.toolCalls,
			siblingIndex,
			createdAt: now
		};

		await db.messages.add(stored);

		// Queue for backend sync
		await markForSync('message', id, 'create');

		// Update conversation message count and timestamp
		const conversation = await db.conversations.get(conversationId);
		if (conversation) {
			await db.conversations.update(conversationId, {
				messageCount: conversation.messageCount + 1,
				updatedAt: now
			});
		}

		return toMessageNode(stored, []);
	});
}

/**
 * Update message content
 */
export async function updateMessage(
	id: string,
	content: string
): Promise<StorageResult<MessageNode>> {
	return withErrorHandling(async () => {
		const existing = await db.messages.get(id);
		if (!existing) {
			throw new Error(`Message not found: ${id}`);
		}

		const updated: StoredMessage = {
			...existing,
			content
		};

		await db.messages.put(updated);

		// Queue for backend sync
		await markForSync('message', id, 'update');

		// Update conversation timestamp
		await db.conversations.update(existing.conversationId, {
			updatedAt: Date.now()
		});

		// Get children for the node
		const children = await db.messages
			.where('parentId')
			.equals(id)
			.sortBy('siblingIndex');

		return toMessageNode(
			updated,
			children.map((c) => c.id)
		);
	});
}

/**
 * Delete a message and all its descendants
 * Returns the IDs of all deleted messages
 */
export async function deleteMessage(id: string): Promise<StorageResult<string[]>> {
	return withErrorHandling(async () => {
		const message = await db.messages.get(id);
		if (!message) {
			throw new Error(`Message not found: ${id}`);
		}

		const deletedIds: string[] = [];

		// Recursively collect all descendant IDs
		async function collectDescendants(messageId: string): Promise<void> {
			deletedIds.push(messageId);
			const children = await db.messages.where('parentId').equals(messageId).toArray();
			for (const child of children) {
				await collectDescendants(child.id);
			}
		}

		await collectDescendants(id);

		// Delete all messages and their attachments in a transaction
		await db.transaction('rw', [db.messages, db.attachments, db.conversations], async () => {
			// Delete attachments
			await db.attachments.where('messageId').anyOf(deletedIds).delete();

			// Delete messages
			await db.messages.bulkDelete(deletedIds);

			// Update conversation message count
			const conversation = await db.conversations.get(message.conversationId);
			if (conversation) {
				await db.conversations.update(message.conversationId, {
					messageCount: Math.max(0, conversation.messageCount - deletedIds.length),
					updatedAt: Date.now()
				});
			}
		});

		// Queue deleted messages for backend sync (after transaction completes)
		for (const deletedId of deletedIds) {
			await markForSync('message', deletedId, 'delete');
		}

		return deletedIds;
	});
}

/**
 * Delete all messages for a conversation
 * Used internally when deleting a conversation
 */
export async function deleteMessagesForConversation(
	conversationId: string
): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		await db.messages.where('conversationId').equals(conversationId).delete();
	});
}

/**
 * Build the message tree structure for a conversation
 * Returns the root message ID and the active path (rightmost branch)
 */
export async function getMessageTree(
	conversationId: string
): Promise<StorageResult<{ rootMessageId: string | null; activePath: BranchPath }>> {
	return withErrorHandling(async () => {
		const messages = await db.messages
			.where('conversationId')
			.equals(conversationId)
			.toArray();

		if (messages.length === 0) {
			return { rootMessageId: null, activePath: [] };
		}

		// Find root message(s) - messages with no parent
		const roots = messages.filter((m) => m.parentId === null);
		if (roots.length === 0) {
			return { rootMessageId: null, activePath: [] };
		}

		// Sort roots by sibling index and take the last one (most recent)
		roots.sort((a, b) => a.siblingIndex - b.siblingIndex);
		const rootMessageId = roots[roots.length - 1].id;

		// Build the active path (following the last child at each level)
		const activePath: BranchPath = [];

		// Build a map for quick lookup
		const messageMap = new Map(messages.map((m) => [m.id, m]));
		const childrenMap = new Map<string, StoredMessage[]>();

		for (const msg of messages) {
			if (msg.parentId) {
				const siblings = childrenMap.get(msg.parentId) ?? [];
				siblings.push(msg);
				childrenMap.set(msg.parentId, siblings);
			}
		}

		// Sort children by sibling index
		Array.from(childrenMap.entries()).forEach(([, children]) => {
			children.sort((a, b) => a.siblingIndex - b.siblingIndex);
		});

		// Traverse from root, always taking the last child
		let currentId: string | null = rootMessageId;
		while (currentId) {
			activePath.push(currentId);
			const children = childrenMap.get(currentId);
			if (children && children.length > 0) {
				// Take the last child (most recent branch)
				currentId = children[children.length - 1].id;
			} else {
				currentId = null;
			}
		}

		return { rootMessageId, activePath };
	});
}

/**
 * Get siblings of a message (messages with the same parent)
 * Returns the message IDs sorted by sibling index
 */
export async function getSiblings(messageId: string): Promise<StorageResult<string[]>> {
	return withErrorHandling(async () => {
		const message = await db.messages.get(messageId);
		if (!message) {
			throw new Error(`Message not found: ${messageId}`);
		}

		let siblings: StoredMessage[];

		if (message.parentId === null) {
			// Root message - get all root messages for this conversation
			siblings = await db.messages
				.where('conversationId')
				.equals(message.conversationId)
				.filter((m) => m.parentId === null)
				.toArray();
		} else {
			// Non-root - get all messages with the same parent
			siblings = await db.messages.where('parentId').equals(message.parentId).toArray();
		}

		siblings.sort((a, b) => a.siblingIndex - b.siblingIndex);
		return siblings.map((s) => s.id);
	});
}

/**
 * Get the path from root to a specific message
 */
export async function getPathToMessage(messageId: string): Promise<StorageResult<BranchPath>> {
	return withErrorHandling(async () => {
		const path: BranchPath = [];
		let currentId: string | null = messageId;

		while (currentId) {
			path.unshift(currentId);
			const msg: StoredMessage | undefined = await db.messages.get(currentId);
			currentId = msg?.parentId ?? null;
		}

		return path;
	});
}

/**
 * Append content to an existing message (for streaming)
 */
export async function appendToMessage(
	id: string,
	contentDelta: string
): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		const existing = await db.messages.get(id);
		if (!existing) {
			throw new Error(`Message not found: ${id}`);
		}

		await db.messages.update(id, {
			content: existing.content + contentDelta
		});
	});
}

/** Search result for message content search */
export interface MessageSearchResult {
	messageId: string;
	conversationId: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	matchIndex: number;
	createdAt: Date;
}

/**
 * Search messages by content
 * Returns matching messages with context snippets
 */
export async function searchMessages(
	query: string,
	options?: {
		conversationId?: string;
		limit?: number;
	}
): Promise<StorageResult<MessageSearchResult[]>> {
	return withErrorHandling(async () => {
		if (!query.trim()) {
			return [];
		}

		const lowerQuery = query.toLowerCase().trim();
		const limit = options?.limit ?? 50;

		// Get messages (optionally filtered by conversation)
		let messagesQuery = db.messages.orderBy('createdAt').reverse();

		const allMessages = await messagesQuery.toArray();

		// Filter by content match and optional conversation filter
		const matches: MessageSearchResult[] = [];

		for (const msg of allMessages) {
			if (matches.length >= limit) break;

			// Skip if filtering by conversation and doesn't match
			if (options?.conversationId && msg.conversationId !== options.conversationId) {
				continue;
			}

			// Check for content match
			const lowerContent = msg.content.toLowerCase();
			const matchIndex = lowerContent.indexOf(lowerQuery);

			if (matchIndex !== -1) {
				matches.push({
					messageId: msg.id,
					conversationId: msg.conversationId,
					role: msg.role,
					content: msg.content,
					matchIndex,
					createdAt: new Date(msg.createdAt)
				});
			}
		}

		return matches;
	});
}
