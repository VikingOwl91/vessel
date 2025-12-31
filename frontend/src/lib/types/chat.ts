/**
 * Chat message types and tree structure definitions
 */

/** Role of a message in a conversation */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Tool call information embedded in assistant messages */
export interface ToolCall {
	id: string;
	name: string;
	arguments: string;
	/** Result of the tool call (stored after execution) */
	result?: string;
	/** Error message if tool call failed */
	error?: string;
}

/** A single chat message */
export interface Message {
	role: MessageRole;
	content: string;
	images?: string[];
	toolCalls?: ToolCall[];
	/** If true, message is hidden from UI (e.g., internal tool result messages) */
	hidden?: boolean;
}

/** A node in the message tree structure (for branching conversations) */
export interface MessageNode {
	id: string;
	message: Message;
	parentId: string | null;
	childIds: string[];
	createdAt: Date;
}

/** Path through the message tree (array of message IDs) */
export type BranchPath = string[];

/** Information about the current branch position */
export interface BranchInfo {
	currentIndex: number;
	totalCount: number;
	siblingIds: string[];
}
