/**
 * Conversations list state management using Svelte 5 runes
 * Handles conversation list, search, filtering, and grouping
 */

import type { Conversation } from '$lib/types/conversation.js';
import { pinConversation, archiveConversation } from '$lib/storage/conversations.js';

/** Date group labels */
type DateGroup = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Previous 30 Days' | 'Older';

/** Grouped conversations by date */
export interface GroupedConversations {
	group: DateGroup;
	conversations: Conversation[];
}

/** Check if two dates are the same day */
function isSameDay(d1: Date, d2: Date): boolean {
	return (
		d1.getFullYear() === d2.getFullYear() &&
		d1.getMonth() === d2.getMonth() &&
		d1.getDate() === d2.getDate()
	);
}

/** Get days difference between two dates */
function getDaysDifference(date: Date, now: Date): number {
	const msPerDay = 24 * 60 * 60 * 1000;
	const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.floor((nowStart.getTime() - dateStart.getTime()) / msPerDay);
}

/** Determine date group for a conversation */
function getDateGroup(date: Date, now: Date): DateGroup {
	if (isSameDay(date, now)) return 'Today';

	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (isSameDay(date, yesterday)) return 'Yesterday';

	const daysDiff = getDaysDifference(date, now);
	if (daysDiff <= 7) return 'Previous 7 Days';
	if (daysDiff <= 30) return 'Previous 30 Days';
	return 'Older';
}

/** Conversations state class with reactive properties */
export class ConversationsState {
	// Core state
	items = $state<Conversation[]>([]);
	searchQuery = $state('');
	isLoading = $state(false);

	// Derived: Filtered conversations by search query
	filtered = $derived.by(() => {
		if (!this.searchQuery.trim()) {
			return this.items.filter((c) => !c.isArchived);
		}

		const query = this.searchQuery.toLowerCase().trim();
		return this.items.filter(
			(c) => !c.isArchived && c.title.toLowerCase().includes(query)
		);
	});

	// Derived: Grouped conversations by date
	grouped = $derived.by(() => {
		const now = new Date();
		const groups = new Map<DateGroup, Conversation[]>();

		// Initialize groups in order
		const orderedGroups: DateGroup[] = [
			'Today',
			'Yesterday',
			'Previous 7 Days',
			'Previous 30 Days',
			'Older'
		];
		for (const group of orderedGroups) {
			groups.set(group, []);
		}

		// Sort by pinned first, then by updatedAt
		const sorted = [...this.filtered].sort((a, b) => {
			if (a.isPinned !== b.isPinned) {
				return a.isPinned ? -1 : 1;
			}
			return b.updatedAt.getTime() - a.updatedAt.getTime();
		});

		// Group conversations
		for (const conversation of sorted) {
			const group = getDateGroup(conversation.updatedAt, now);
			groups.get(group)!.push(conversation);
		}

		// Convert to array, filtering empty groups
		const result: GroupedConversations[] = [];
		for (const group of orderedGroups) {
			const conversations = groups.get(group)!;
			if (conversations.length > 0) {
				result.push({ group, conversations });
			}
		}

		return result;
	});

	// Derived: Archived conversations
	archived = $derived.by(() => {
		return this.items
			.filter((c) => c.isArchived)
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	});

	// Derived: Pinned conversations
	pinned = $derived.by(() => {
		return this.items
			.filter((c) => c.isPinned && !c.isArchived)
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	});

	/**
	 * Load conversations (typically from IndexedDB)
	 * @param conversations Array of conversations to load
	 */
	load(conversations: Conversation[]): void {
		this.items = [...conversations];
	}

	/**
	 * Add a new conversation
	 * @param conversation The conversation to add
	 */
	add(conversation: Conversation): void {
		this.items = [conversation, ...this.items];
	}

	/**
	 * Update an existing conversation
	 * @param id The conversation ID
	 * @param updates Partial conversation updates
	 */
	update(id: string, updates: Partial<Omit<Conversation, 'id'>>): void {
		this.items = this.items.map((c) => {
			if (c.id === id) {
				return { ...c, ...updates, updatedAt: new Date() };
			}
			return c;
		});
	}

	/**
	 * Remove a conversation
	 * @param id The conversation ID to remove
	 */
	remove(id: string): void {
		this.items = this.items.filter((c) => c.id !== id);
	}

	/**
	 * Toggle pin status of a conversation
	 * Persists to IndexedDB and queues for backend sync
	 * @param id The conversation ID
	 */
	async pin(id: string): Promise<void> {
		const conversation = this.items.find((c) => c.id === id);
		if (conversation) {
			// Update in-memory state immediately for responsive UI
			this.update(id, { isPinned: !conversation.isPinned });

			// Persist to IndexedDB and queue for sync
			const result = await pinConversation(id);
			if (!result.success) {
				// Revert on failure
				this.update(id, { isPinned: conversation.isPinned });
				console.error('Failed to persist pin state:', result.error);
			}
		}
	}

	/**
	 * Toggle archive status of a conversation
	 * Persists to IndexedDB and queues for backend sync
	 * @param id The conversation ID
	 */
	async archive(id: string): Promise<void> {
		const conversation = this.items.find((c) => c.id === id);
		if (conversation) {
			// Update in-memory state immediately for responsive UI
			this.update(id, { isArchived: !conversation.isArchived });

			// Persist to IndexedDB and queue for sync
			const result = await archiveConversation(id);
			if (!result.success) {
				// Revert on failure
				this.update(id, { isArchived: conversation.isArchived });
				console.error('Failed to persist archive state:', result.error);
			}
		}
	}

	/**
	 * Find a conversation by ID
	 * @param id The conversation ID
	 */
	find(id: string): Conversation | undefined {
		return this.items.find((c) => c.id === id);
	}

	/**
	 * Clear search query
	 */
	clearSearch(): void {
		this.searchQuery = '';
	}

	/**
	 * Update the system prompt for a conversation
	 * @param id The conversation ID
	 * @param systemPromptId The prompt ID (or null to clear)
	 */
	setSystemPrompt(id: string, systemPromptId: string | null): void {
		this.update(id, { systemPromptId });
	}

	// ========================================================================
	// Project-related methods
	// ========================================================================

	/**
	 * Get conversations for a specific project
	 * @param projectId The project ID
	 */
	forProject(projectId: string): Conversation[] {
		return this.items
			.filter((c) => !c.isArchived && c.projectId === projectId)
			.sort((a, b) => {
				if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
				return b.updatedAt.getTime() - a.updatedAt.getTime();
			});
	}

	/**
	 * Get conversations without a project
	 */
	withoutProject(): Conversation[] {
		return this.items
			.filter((c) => !c.isArchived && (!c.projectId || c.projectId === null))
			.sort((a, b) => {
				if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
				return b.updatedAt.getTime() - a.updatedAt.getTime();
			});
	}

	/**
	 * Move a conversation to a project (or remove from project if null)
	 * @param id The conversation ID
	 * @param projectId The project ID (or null to remove from project)
	 */
	moveToProject(id: string, projectId: string | null): void {
		this.update(id, { projectId });
	}

	/**
	 * Update a conversation's summary
	 * @param id The conversation ID
	 * @param summary The summary text
	 */
	updateSummary(id: string, summary: string): void {
		this.update(id, { summary, summaryUpdatedAt: new Date() });
	}

	/**
	 * Get all project IDs that have conversations
	 */
	getProjectIdsWithConversations(): string[] {
		const projectIds = new Set<string>();
		for (const c of this.items) {
			if (!c.isArchived && c.projectId) {
				projectIds.add(c.projectId);
			}
		}
		return Array.from(projectIds);
	}
}

/** Singleton conversations state instance */
export const conversationsState = new ConversationsState();
