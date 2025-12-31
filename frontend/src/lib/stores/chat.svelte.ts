/**
 * Chat state management using Svelte 5 runes
 * Handles message tree, streaming, and branch navigation
 */

import type { Message, MessageNode, BranchPath, BranchInfo } from '$lib/types/chat.js';

/** Generate a unique ID for messages */
function generateId(): string {
	return crypto.randomUUID();
}

/** Chat state class with reactive properties */
export class ChatState {
	// Core state
	conversationId = $state<string | null>(null);
	messageTree = $state<Map<string, MessageNode>>(new Map());
	rootMessageId = $state<string | null>(null);
	activePath = $state<BranchPath>([]);

	// Streaming state
	isStreaming = $state(false);
	streamingMessageId = $state<string | null>(null);
	streamBuffer = $state('');

	// Derived: Get visible messages along the active path (excluding hidden messages for UI)
	visibleMessages = $derived.by(() => {
		const messages: MessageNode[] = [];
		for (const id of this.activePath) {
			const node = this.messageTree.get(id);
			// Skip hidden messages (e.g., internal tool result context)
			if (node && !node.message.hidden) {
				messages.push(node);
			}
		}
		return messages;
	});

	// Derived: Get ALL messages along active path (including hidden, for API calls)
	allMessages = $derived.by(() => {
		const messages: MessageNode[] = [];
		for (const id of this.activePath) {
			const node = this.messageTree.get(id);
			if (node) {
				messages.push(node);
			}
		}
		return messages;
	});

	// Derived: Can regenerate the last assistant message
	canRegenerate = $derived.by(() => {
		if (this.activePath.length === 0 || this.isStreaming) {
			return false;
		}
		const lastId = this.activePath[this.activePath.length - 1];
		const lastNode = this.messageTree.get(lastId);
		return lastNode?.message.role === 'assistant';
	});

	/**
	 * Add a new message to the tree
	 * @param message The message content
	 * @param parentId Optional parent message ID (defaults to last in active path)
	 * @returns The ID of the newly created message node
	 */
	addMessage(message: Message, parentId?: string | null): string {
		const id = generateId();
		const effectiveParentId = parentId ?? this.activePath[this.activePath.length - 1] ?? null;

		const node: MessageNode = {
			id,
			message,
			parentId: effectiveParentId,
			childIds: [],
			createdAt: new Date()
		};

		// Update parent's childIds
		if (effectiveParentId) {
			const parent = this.messageTree.get(effectiveParentId);
			if (parent) {
				const updatedParent = {
					...parent,
					childIds: [...parent.childIds, id]
				};
				this.messageTree = new Map(this.messageTree).set(effectiveParentId, updatedParent);
			}
		}

		// Add the new node
		this.messageTree = new Map(this.messageTree).set(id, node);

		// Set as root if first message
		if (!this.rootMessageId) {
			this.rootMessageId = id;
		}

		// Update active path
		this.activePath = [...this.activePath, id];

		return id;
	}

	/**
	 * Start streaming a new assistant message
	 * @returns The ID of the streaming message
	 */
	startStreaming(): string {
		const id = this.addMessage({ role: 'assistant', content: '' });
		this.isStreaming = true;
		this.streamingMessageId = id;
		this.streamBuffer = '';
		return id;
	}

	/**
	 * Append content to the currently streaming message
	 * @param content The content chunk to append
	 */
	appendToStreaming(content: string): void {
		if (!this.streamingMessageId) return;

		this.streamBuffer += content;

		const node = this.messageTree.get(this.streamingMessageId);
		if (node) {
			const updatedNode: MessageNode = {
				...node,
				message: {
					...node.message,
					content: this.streamBuffer
				}
			};
			this.messageTree = new Map(this.messageTree).set(this.streamingMessageId, updatedNode);
		}
	}

	/**
	 * Complete the streaming process
	 */
	finishStreaming(): void {
		this.isStreaming = false;
		this.streamingMessageId = null;
		this.streamBuffer = '';
	}

	/**
	 * Get branch info for a specific message
	 * @param messageId The message ID to get branch info for
	 */
	getBranchInfo(messageId: string): BranchInfo | null {
		const node = this.messageTree.get(messageId);
		if (!node) return null;

		if (!node.parentId) {
			// Root message has no siblings
			return { currentIndex: 0, totalCount: 1, siblingIds: [messageId] };
		}

		const parent = this.messageTree.get(node.parentId);
		if (!parent) return null;

		const siblingIds = parent.childIds;
		const currentIndex = siblingIds.indexOf(messageId);

		return {
			currentIndex,
			totalCount: siblingIds.length,
			siblingIds
		};
	}

	/**
	 * Switch to a different branch at a given message
	 * @param messageId The current message ID
	 * @param direction 'prev' or 'next' to navigate siblings
	 */
	switchBranch(messageId: string, direction: 'prev' | 'next'): void {
		const branchInfo = this.getBranchInfo(messageId);
		if (!branchInfo || branchInfo.totalCount <= 1) return;

		const { currentIndex, siblingIds } = branchInfo;
		let newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

		// Wrap around
		if (newIndex < 0) newIndex = siblingIds.length - 1;
		if (newIndex >= siblingIds.length) newIndex = 0;

		const newMessageId = siblingIds[newIndex];
		this.switchToMessage(messageId, newMessageId);
	}

	/**
	 * Switch from one message to another sibling message
	 * @param currentMessageId The current message ID in the active path
	 * @param targetMessageId The target sibling message ID to switch to
	 */
	switchToMessage(currentMessageId: string, targetMessageId: string): void {
		// Rebuild active path up to and including the new message
		const pathIndex = this.activePath.indexOf(currentMessageId);
		if (pathIndex === -1) return;

		// Keep path up to the parent, then follow new branch
		const newPath = this.activePath.slice(0, pathIndex);
		newPath.push(targetMessageId);

		// Follow the first child of each node to complete the path
		let currentId = targetMessageId;
		let currentNode = this.messageTree.get(currentId);
		while (currentNode && currentNode.childIds.length > 0) {
			const firstChildId = currentNode.childIds[0];
			newPath.push(firstChildId);
			currentNode = this.messageTree.get(firstChildId);
		}

		this.activePath = newPath;
	}

	/**
	 * Add a sibling message to an existing message (same parent)
	 * Used for regeneration and editing flows
	 * @param siblingId The existing sibling message ID
	 * @param message The new message content
	 * @returns The ID of the newly created sibling message
	 */
	addSiblingMessage(siblingId: string, message: Message): string {
		const siblingNode = this.messageTree.get(siblingId);
		if (!siblingNode) {
			throw new Error(`Sibling message ${siblingId} not found`);
		}

		const id = generateId();
		const parentId = siblingNode.parentId;

		const node: MessageNode = {
			id,
			message,
			parentId,
			childIds: [],
			createdAt: new Date()
		};

		// Update parent's childIds
		if (parentId) {
			const parent = this.messageTree.get(parentId);
			if (parent) {
				const updatedParent = {
					...parent,
					childIds: [...parent.childIds, id]
				};
				this.messageTree = new Map(this.messageTree).set(parentId, updatedParent);
			}
		}

		// Add the new node
		this.messageTree = new Map(this.messageTree).set(id, node);

		return id;
	}

	/**
	 * Start regeneration by creating a new assistant message as sibling
	 * @param existingAssistantId The existing assistant message to regenerate from
	 * @returns The ID of the new streaming message, or null if regeneration not possible
	 */
	startRegeneration(existingAssistantId: string): string | null {
		const existingNode = this.messageTree.get(existingAssistantId);
		if (!existingNode || existingNode.message.role !== 'assistant') {
			return null;
		}

		// Create new assistant message as sibling
		const newId = this.addSiblingMessage(existingAssistantId, {
			role: 'assistant',
			content: ''
		});

		// Update active path to point to new message
		const pathIndex = this.activePath.indexOf(existingAssistantId);
		if (pathIndex !== -1) {
			this.activePath = [...this.activePath.slice(0, pathIndex), newId];
		}

		// Set up streaming state
		this.isStreaming = true;
		this.streamingMessageId = newId;
		this.streamBuffer = '';

		return newId;
	}

	/**
	 * Start edit flow by creating a new user message as sibling and preparing for response
	 * @param existingUserMessageId The existing user message to edit
	 * @param newContent The new content for the edited message
	 * @param images Optional images to include
	 * @returns The ID of the new user message, or null if edit not possible
	 */
	startEditWithNewBranch(
		existingUserMessageId: string,
		newContent: string,
		images?: string[]
	): string | null {
		const existingNode = this.messageTree.get(existingUserMessageId);
		if (!existingNode || existingNode.message.role !== 'user') {
			return null;
		}

		// Create new user message as sibling
		const newUserMessageId = this.addSiblingMessage(existingUserMessageId, {
			role: 'user',
			content: newContent,
			images
		});

		// Update active path to point to new user message
		// Truncate the path at the user message level (remove any children from old branch)
		const pathIndex = this.activePath.indexOf(existingUserMessageId);
		if (pathIndex !== -1) {
			this.activePath = [...this.activePath.slice(0, pathIndex), newUserMessageId];
		}

		return newUserMessageId;
	}

	/**
	 * Get the parent user message for a given assistant message
	 * Useful for getting context when regenerating
	 * @param assistantMessageId The assistant message ID
	 * @returns The parent user message node, or null if not found
	 */
	getParentUserMessage(assistantMessageId: string): MessageNode | null {
		const assistantNode = this.messageTree.get(assistantMessageId);
		if (!assistantNode?.parentId) return null;

		const parentNode = this.messageTree.get(assistantNode.parentId);
		if (!parentNode || parentNode.message.role !== 'user') return null;

		return parentNode;
	}

	/**
	 * Get the path from root to a specific message
	 * @param messageId Target message ID
	 */
	getPathToMessage(messageId: string): BranchPath {
		const path: BranchPath = [];
		let currentId: string | null = messageId;

		while (currentId) {
			path.unshift(currentId);
			const node = this.messageTree.get(currentId);
			currentId = node?.parentId ?? null;
		}

		return path;
	}

	/**
	 * Get all leaf nodes (messages with no children)
	 */
	getLeafNodes(): MessageNode[] {
		return Array.from(this.messageTree.values()).filter((node) => node.childIds.length === 0);
	}

	/**
	 * Reset the chat state
	 */
	reset(): void {
		this.conversationId = null;
		this.messageTree = new Map();
		this.rootMessageId = null;
		this.activePath = [];
		this.isStreaming = false;
		this.streamingMessageId = null;
		this.streamBuffer = '';
	}

	/**
	 * Load a conversation into the chat state
	 * @param conversationId The conversation ID
	 * @param messages The message tree map
	 * @param rootId The root message ID
	 * @param path The active path to restore
	 */
	load(
		conversationId: string,
		messages: Map<string, MessageNode>,
		rootId: string | null,
		path: BranchPath
	): void {
		this.conversationId = conversationId;
		this.messageTree = new Map(messages);
		this.rootMessageId = rootId;
		this.activePath = [...path];
	}
}

/** Singleton chat state instance */
export const chatState = new ChatState();
