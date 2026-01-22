/**
 * AgentsState store tests
 *
 * Tests the reactive state management for agents.
 * Uses fake-indexeddb for in-memory IndexedDB testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, generateId } from '$lib/storage/db.js';

// Import after fake-indexeddb is set up
let AgentsState: typeof import('./agents.svelte.js').AgentsState;
let agentsState: InstanceType<typeof AgentsState>;

describe('AgentsState', () => {
	beforeEach(async () => {
		// Clear database
		await db.agents.clear();
		await db.projectAgents.clear();

		// Dynamically import to get fresh state
		vi.resetModules();
		const module = await import('./agents.svelte.js');
		AgentsState = module.AgentsState;
		agentsState = new AgentsState();

		// Wait for initial load to complete
		await agentsState.ready();
	});

	afterEach(async () => {
		await db.agents.clear();
		await db.projectAgents.clear();
	});

	describe('initialization', () => {
		it('starts with empty agents array', async () => {
			expect(agentsState.agents).toEqual([]);
		});

		it('loads agents on construction in browser', async () => {
			// Pre-populate database
			await db.agents.add({
				id: generateId(),
				name: 'Test Agent',
				description: 'A test agent',
				promptId: null,
				enabledToolNames: [],
				preferredModel: null,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});

			// Create fresh instance
			vi.resetModules();
			const module = await import('./agents.svelte.js');
			const freshState = new module.AgentsState();
			await freshState.ready();

			expect(freshState.agents.length).toBe(1);
			expect(freshState.agents[0].name).toBe('Test Agent');
		});
	});

	describe('sortedAgents', () => {
		it('returns agents sorted alphabetically by name', async () => {
			await agentsState.add({ name: 'Zeta', description: '' });
			await agentsState.add({ name: 'Alpha', description: '' });
			await agentsState.add({ name: 'Mid', description: '' });

			const sorted = agentsState.sortedAgents;

			expect(sorted[0].name).toBe('Alpha');
			expect(sorted[1].name).toBe('Mid');
			expect(sorted[2].name).toBe('Zeta');
		});
	});

	describe('add', () => {
		it('adds agent to state', async () => {
			const agent = await agentsState.add({
				name: 'New Agent',
				description: 'Test description'
			});

			expect(agent).not.toBeNull();
			expect(agentsState.agents.length).toBe(1);
			expect(agentsState.agents[0].name).toBe('New Agent');
		});

		it('persists to storage', async () => {
			const agent = await agentsState.add({
				name: 'Persistent Agent',
				description: ''
			});

			// Verify in database
			const stored = await db.agents.get(agent!.id);
			expect(stored).not.toBeUndefined();
			expect(stored!.name).toBe('Persistent Agent');
		});

		it('returns agent with generated id and timestamps', async () => {
			const before = Date.now();
			const agent = await agentsState.add({
				name: 'Agent',
				description: ''
			});
			const after = Date.now();

			expect(agent).not.toBeNull();
			expect(agent!.id).toBeTruthy();
			expect(agent!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
			expect(agent!.createdAt.getTime()).toBeLessThanOrEqual(after);
		});
	});

	describe('update', () => {
		it('updates agent in state', async () => {
			const agent = await agentsState.add({ name: 'Original', description: '' });
			expect(agent).not.toBeNull();

			const success = await agentsState.update(agent!.id, { name: 'Updated' });

			expect(success).toBe(true);
			expect(agentsState.agents[0].name).toBe('Updated');
		});

		it('persists changes', async () => {
			const agent = await agentsState.add({ name: 'Original', description: '' });
			await agentsState.update(agent!.id, { description: 'New description' });

			const stored = await db.agents.get(agent!.id);
			expect(stored!.description).toBe('New description');
		});

		it('updates updatedAt timestamp', async () => {
			const agent = await agentsState.add({ name: 'Agent', description: '' });
			const originalUpdatedAt = agent!.updatedAt.getTime();

			await new Promise((r) => setTimeout(r, 10));
			await agentsState.update(agent!.id, { name: 'Changed' });

			expect(agentsState.agents[0].updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
		});

		it('returns false for non-existent agent', async () => {
			const success = await agentsState.update('non-existent', { name: 'Updated' });
			expect(success).toBe(false);
		});
	});

	describe('remove', () => {
		it('removes agent from state', async () => {
			const agent = await agentsState.add({ name: 'To Delete', description: '' });
			expect(agentsState.agents.length).toBe(1);

			const success = await agentsState.remove(agent!.id);

			expect(success).toBe(true);
			expect(agentsState.agents.length).toBe(0);
		});

		it('removes from storage', async () => {
			const agent = await agentsState.add({ name: 'To Delete', description: '' });
			await agentsState.remove(agent!.id);

			const stored = await db.agents.get(agent!.id);
			expect(stored).toBeUndefined();
		});

		it('removes project-agent associations', async () => {
			const agent = await agentsState.add({ name: 'Agent', description: '' });
			const projectId = generateId();

			await agentsState.assignToProject(agent!.id, projectId);

			// Verify assignment exists
			let assignments = await db.projectAgents.where('agentId').equals(agent!.id).toArray();
			expect(assignments.length).toBe(1);

			await agentsState.remove(agent!.id);

			// Verify assignment removed
			assignments = await db.projectAgents.where('agentId').equals(agent!.id).toArray();
			expect(assignments.length).toBe(0);
		});
	});

	describe('get', () => {
		it('returns agent by id', async () => {
			const agent = await agentsState.add({ name: 'Test', description: 'desc' });

			const found = agentsState.get(agent!.id);

			expect(found).not.toBeUndefined();
			expect(found!.name).toBe('Test');
		});

		it('returns undefined for missing id', async () => {
			const found = agentsState.get('non-existent');
			expect(found).toBeUndefined();
		});
	});

	describe('project relationships', () => {
		it('gets agents for specific project', async () => {
			const agent1 = await agentsState.add({ name: 'Agent 1', description: '' });
			const agent2 = await agentsState.add({ name: 'Agent 2', description: '' });
			const agent3 = await agentsState.add({ name: 'Agent 3', description: '' });

			const projectId = generateId();
			const otherProjectId = generateId();

			await agentsState.assignToProject(agent1!.id, projectId);
			await agentsState.assignToProject(agent2!.id, projectId);
			await agentsState.assignToProject(agent3!.id, otherProjectId);

			const agents = await agentsState.getForProject(projectId);

			expect(agents.length).toBe(2);
			const names = agents.map((a) => a.name).sort();
			expect(names).toEqual(['Agent 1', 'Agent 2']);
		});

		it('assigns agent to project', async () => {
			const agent = await agentsState.add({ name: 'Agent', description: '' });
			const projectId = generateId();

			const success = await agentsState.assignToProject(agent!.id, projectId);

			expect(success).toBe(true);
			const agents = await agentsState.getForProject(projectId);
			expect(agents.length).toBe(1);
		});

		it('removes agent from project', async () => {
			const agent = await agentsState.add({ name: 'Agent', description: '' });
			const projectId = generateId();

			await agentsState.assignToProject(agent!.id, projectId);
			const success = await agentsState.removeFromProject(agent!.id, projectId);

			expect(success).toBe(true);
			const agents = await agentsState.getForProject(projectId);
			expect(agents.length).toBe(0);
		});

		it('returns empty array for project with no agents', async () => {
			const agents = await agentsState.getForProject(generateId());
			expect(agents).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('sets error state on failure', async () => {
			// Force an error by updating non-existent agent
			await agentsState.update('non-existent', { name: 'Test' });

			expect(agentsState.error).not.toBeNull();
			expect(agentsState.error).toContain('not found');
		});

		it('clears error state with clearError', async () => {
			await agentsState.update('non-existent', { name: 'Test' });
			expect(agentsState.error).not.toBeNull();

			agentsState.clearError();

			expect(agentsState.error).toBeNull();
		});
	});

	describe('loading state', () => {
		it('is false after load completes', async () => {
			expect(agentsState.isLoading).toBe(false);
		});
	});
});
