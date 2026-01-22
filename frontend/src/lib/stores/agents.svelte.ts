/**
 * Agents state management using Svelte 5 runes
 * Manages agent configurations with IndexedDB persistence
 */

import {
	getAllAgents,
	getAgent,
	createAgent,
	updateAgent,
	deleteAgent,
	assignAgentToProject,
	removeAgentFromProject,
	getAgentsForProject,
	type Agent,
	type CreateAgentData,
	type UpdateAgentData
} from '$lib/storage';

/** Agents state class with reactive properties */
export class AgentsState {
	/** All available agents */
	agents = $state<Agent[]>([]);

	/** Loading state */
	isLoading = $state(false);

	/** Error state */
	error = $state<string | null>(null);

	/** Promise that resolves when initial load is complete */
	private _readyPromise: Promise<void> | null = null;
	private _readyResolve: (() => void) | null = null;

	/** Derived: agents sorted alphabetically by name */
	get sortedAgents(): Agent[] {
		return [...this.agents].sort((a, b) => a.name.localeCompare(b.name));
	}

	constructor() {
		// Create ready promise
		this._readyPromise = new Promise((resolve) => {
			this._readyResolve = resolve;
		});

		// Load agents on initialization (client-side only)
		if (typeof window !== 'undefined') {
			this.load();
		} else {
			// SSR: resolve immediately
			this._readyResolve?.();
		}
	}

	/** Wait for initial load to complete */
	async ready(): Promise<void> {
		return this._readyPromise ?? Promise.resolve();
	}

	/**
	 * Load all agents from IndexedDB
	 */
	async load(): Promise<void> {
		this.isLoading = true;
		this.error = null;

		try {
			const result = await getAllAgents();
			if (result.success) {
				this.agents = result.data;
			} else {
				this.error = result.error;
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to load agents';
		} finally {
			this.isLoading = false;
			this._readyResolve?.();
		}
	}

	/**
	 * Create a new agent
	 */
	async add(data: CreateAgentData): Promise<Agent | null> {
		try {
			const result = await createAgent(data);
			if (result.success) {
				this.agents = [...this.agents, result.data];
				return result.data;
			} else {
				this.error = result.error;
				return null;
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to create agent';
			return null;
		}
	}

	/**
	 * Update an existing agent
	 */
	async update(id: string, updates: UpdateAgentData): Promise<boolean> {
		try {
			const result = await updateAgent(id, updates);
			if (result.success) {
				this.agents = this.agents.map((a) => (a.id === id ? result.data : a));
				return true;
			} else {
				this.error = result.error;
				return false;
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to update agent';
			return false;
		}
	}

	/**
	 * Delete an agent
	 */
	async remove(id: string): Promise<boolean> {
		try {
			const result = await deleteAgent(id);
			if (result.success) {
				this.agents = this.agents.filter((a) => a.id !== id);
				return true;
			} else {
				this.error = result.error;
				return false;
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to delete agent';
			return false;
		}
	}

	/**
	 * Get an agent by ID
	 */
	get(id: string): Agent | undefined {
		return this.agents.find((a) => a.id === id);
	}

	/**
	 * Assign an agent to a project
	 */
	async assignToProject(agentId: string, projectId: string): Promise<boolean> {
		try {
			const result = await assignAgentToProject(agentId, projectId);
			return result.success;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to assign agent to project';
			return false;
		}
	}

	/**
	 * Remove an agent from a project
	 */
	async removeFromProject(agentId: string, projectId: string): Promise<boolean> {
		try {
			const result = await removeAgentFromProject(agentId, projectId);
			return result.success;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to remove agent from project';
			return false;
		}
	}

	/**
	 * Get all agents assigned to a project
	 */
	async getForProject(projectId: string): Promise<Agent[]> {
		try {
			const result = await getAgentsForProject(projectId);
			if (result.success) {
				return result.data;
			} else {
				this.error = result.error;
				return [];
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to get agents for project';
			return [];
		}
	}

	/**
	 * Clear any error state
	 */
	clearError(): void {
		this.error = null;
	}
}

/** Singleton agents state instance */
export const agentsState = new AgentsState();
