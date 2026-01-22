/**
 * Conversation types for the chat application
 */

import type { MessageNode, BranchPath } from './chat.js';

/** Basic conversation metadata */
export interface Conversation {
	id: string;
	title: string;
	model: string;
	createdAt: Date;
	updatedAt: Date;
	isPinned: boolean;
	isArchived: boolean;
	messageCount: number;
	/** Optional system prompt ID for this conversation (null = use global default) */
	systemPromptId?: string | null;
	/** Optional project ID this conversation belongs to */
	projectId?: string | null;
	/** Optional agent ID for this conversation (determines prompt and tools) */
	agentId?: string | null;
	/** Auto-generated conversation summary for cross-chat context */
	summary?: string | null;
	/** Timestamp when summary was last updated */
	summaryUpdatedAt?: Date | null;
}

/** Full conversation including message tree and navigation state */
export interface ConversationFull extends Conversation {
	messages: Map<string, MessageNode>;
	activePath: BranchPath;
	rootMessageId: string | null;
}
