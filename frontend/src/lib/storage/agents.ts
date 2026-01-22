/**
 * Agents storage operations
 * CRUD operations for agents and project-agent relationships
 */

import { db, generateId, withErrorHandling } from './db.js';
import type { StoredAgent, StoredProjectAgent, StorageResult } from './db.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Agent for UI display (with Date objects)
 */
export interface Agent {
	id: string;
	name: string;
	description: string;
	promptId: string | null;
	enabledToolNames: string[];
	preferredModel: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateAgentData {
	name: string;
	description: string;
	promptId?: string | null;
	enabledToolNames?: string[];
	preferredModel?: string | null;
}

export interface UpdateAgentData {
	name?: string;
	description?: string;
	promptId?: string | null;
	enabledToolNames?: string[];
	preferredModel?: string | null;
}

// ============================================================================
// Converters
// ============================================================================

function toDomainAgent(stored: StoredAgent): Agent {
	return {
		id: stored.id,
		name: stored.name,
		description: stored.description,
		promptId: stored.promptId,
		enabledToolNames: stored.enabledToolNames,
		preferredModel: stored.preferredModel,
		createdAt: new Date(stored.createdAt),
		updatedAt: new Date(stored.updatedAt)
	};
}

// ============================================================================
// Agent CRUD
// ============================================================================

/**
 * Get all agents, sorted by name
 */
export async function getAllAgents(): Promise<StorageResult<Agent[]>> {
	return withErrorHandling(async () => {
		const all = await db.agents.toArray();
		const sorted = all.sort((a, b) => a.name.localeCompare(b.name));
		return sorted.map(toDomainAgent);
	});
}

/**
 * Get a single agent by ID
 */
export async function getAgent(id: string): Promise<StorageResult<Agent | null>> {
	return withErrorHandling(async () => {
		const stored = await db.agents.get(id);
		return stored ? toDomainAgent(stored) : null;
	});
}

/**
 * Create a new agent
 */
export async function createAgent(data: CreateAgentData): Promise<StorageResult<Agent>> {
	return withErrorHandling(async () => {
		const now = Date.now();
		const stored: StoredAgent = {
			id: generateId(),
			name: data.name,
			description: data.description,
			promptId: data.promptId ?? null,
			enabledToolNames: data.enabledToolNames ?? [],
			preferredModel: data.preferredModel ?? null,
			createdAt: now,
			updatedAt: now
		};

		await db.agents.add(stored);
		return toDomainAgent(stored);
	});
}

/**
 * Update an existing agent
 */
export async function updateAgent(
	id: string,
	updates: UpdateAgentData
): Promise<StorageResult<Agent>> {
	return withErrorHandling(async () => {
		const existing = await db.agents.get(id);
		if (!existing) {
			throw new Error(`Agent not found: ${id}`);
		}

		const updated: StoredAgent = {
			...existing,
			...updates,
			updatedAt: Date.now()
		};

		await db.agents.put(updated);
		return toDomainAgent(updated);
	});
}

/**
 * Delete an agent and all associated project assignments
 */
export async function deleteAgent(id: string): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		await db.transaction('rw', [db.agents, db.projectAgents], async () => {
			// Remove all project-agent associations
			await db.projectAgents.where('agentId').equals(id).delete();
			// Delete the agent itself
			await db.agents.delete(id);
		});
	});
}

// ============================================================================
// Project-Agent Relationships
// ============================================================================

/**
 * Assign an agent to a project (adds to roster)
 * Idempotent: does nothing if assignment already exists
 */
export async function assignAgentToProject(
	agentId: string,
	projectId: string
): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		// Check if assignment already exists
		const existing = await db.projectAgents
			.where('[projectId+agentId]')
			.equals([projectId, agentId])
			.first();

		if (existing) {
			return; // Already assigned, do nothing
		}

		const assignment: StoredProjectAgent = {
			id: generateId(),
			projectId,
			agentId,
			createdAt: Date.now()
		};

		await db.projectAgents.add(assignment);
	});
}

/**
 * Remove an agent from a project roster
 */
export async function removeAgentFromProject(
	agentId: string,
	projectId: string
): Promise<StorageResult<void>> {
	return withErrorHandling(async () => {
		await db.projectAgents
			.where('[projectId+agentId]')
			.equals([projectId, agentId])
			.delete();
	});
}

/**
 * Get all agents assigned to a project (sorted by name)
 */
export async function getAgentsForProject(projectId: string): Promise<StorageResult<Agent[]>> {
	return withErrorHandling(async () => {
		const assignments = await db.projectAgents.where('projectId').equals(projectId).toArray();
		const agentIds = assignments.map((a) => a.agentId);

		if (agentIds.length === 0) {
			return [];
		}

		const agents = await db.agents.where('id').anyOf(agentIds).toArray();
		const sorted = agents.sort((a, b) => a.name.localeCompare(b.name));
		return sorted.map(toDomainAgent);
	});
}

/**
 * Get all project IDs that an agent is assigned to
 */
export async function getProjectsForAgent(agentId: string): Promise<StorageResult<string[]>> {
	return withErrorHandling(async () => {
		const assignments = await db.projectAgents.where('agentId').equals(agentId).toArray();
		return assignments.map((a) => a.projectId);
	});
}
