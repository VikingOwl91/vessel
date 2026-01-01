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
}

/** Full conversation including message tree and navigation state */
export interface ConversationFull extends Conversation {
	messages: Map<string, MessageNode>;
	activePath: BranchPath;
	rootMessageId: string | null;
}
