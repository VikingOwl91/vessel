/**
 * Agents storage layer tests
 *
 * Tests CRUD operations for agents and project-agent relationships.
 * Uses fake-indexeddb for in-memory IndexedDB testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, generateId } from './db.js';
import {
	createAgent,
	getAllAgents,
	getAgent,
	updateAgent,
	deleteAgent,
	assignAgentToProject,
	removeAgentFromProject,
	getAgentsForProject
} from './agents.js';

describe('agents storage', () => {
	// Reset database before each test
	beforeEach(async () => {
		// Clear all agent-related tables
		await db.agents.clear();
		await db.projectAgents.clear();
	});

	afterEach(async () => {
		await db.agents.clear();
		await db.projectAgents.clear();
	});

	describe('createAgent', () => {
		it('creates agent with required fields', async () => {
			const result = await createAgent({
				name: 'Test Agent',
				description: 'A test agent'
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe('Test Agent');
				expect(result.data.description).toBe('A test agent');
			}
		});

		it('generates unique id', async () => {
			const result1 = await createAgent({ name: 'Agent 1', description: '' });
			const result2 = await createAgent({ name: 'Agent 2', description: '' });

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			if (result1.success && result2.success) {
				expect(result1.data.id).not.toBe(result2.data.id);
			}
		});

		it('sets createdAt and updatedAt timestamps', async () => {
			const before = Date.now();
			const result = await createAgent({ name: 'Agent', description: '' });
			const after = Date.now();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.createdAt.getTime()).toBeGreaterThanOrEqual(before);
				expect(result.data.createdAt.getTime()).toBeLessThanOrEqual(after);
				expect(result.data.updatedAt.getTime()).toBe(result.data.createdAt.getTime());
			}
		});

		it('stores optional promptId', async () => {
			const promptId = generateId();
			const result = await createAgent({
				name: 'Agent with Prompt',
				description: '',
				promptId
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.promptId).toBe(promptId);
			}
		});

		it('stores enabledToolNames array', async () => {
			const tools = ['fetch_url', 'web_search', 'calculate'];
			const result = await createAgent({
				name: 'Agent with Tools',
				description: '',
				enabledToolNames: tools
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.enabledToolNames).toEqual(tools);
			}
		});

		it('stores optional preferredModel', async () => {
			const result = await createAgent({
				name: 'Agent with Model',
				description: '',
				preferredModel: 'llama3.2:8b'
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.preferredModel).toBe('llama3.2:8b');
			}
		});

		it('defaults optional fields appropriately', async () => {
			const result = await createAgent({
				name: 'Minimal Agent',
				description: 'Just the basics'
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.promptId).toBeNull();
				expect(result.data.enabledToolNames).toEqual([]);
				expect(result.data.preferredModel).toBeNull();
			}
		});
	});

	describe('getAllAgents', () => {
		it('returns empty array when no agents', async () => {
			const result = await getAllAgents();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual([]);
			}
		});

		it('returns all agents sorted by name', async () => {
			await createAgent({ name: 'Charlie', description: '' });
			await createAgent({ name: 'Alice', description: '' });
			await createAgent({ name: 'Bob', description: '' });

			const result = await getAllAgents();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.length).toBe(3);
				expect(result.data[0].name).toBe('Alice');
				expect(result.data[1].name).toBe('Bob');
				expect(result.data[2].name).toBe('Charlie');
			}
		});
	});

	describe('getAgent', () => {
		it('returns agent by id', async () => {
			const createResult = await createAgent({ name: 'Test Agent', description: 'desc' });
			expect(createResult.success).toBe(true);
			if (!createResult.success) return;

			const result = await getAgent(createResult.data.id);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data?.name).toBe('Test Agent');
				expect(result.data?.description).toBe('desc');
			}
		});

		it('returns null for non-existent id', async () => {
			const result = await getAgent('non-existent-id');

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBeNull();
			}
		});
	});

	describe('updateAgent', () => {
		it('updates name', async () => {
			const createResult = await createAgent({ name: 'Original', description: '' });
			expect(createResult.success).toBe(true);
			if (!createResult.success) return;

			const result = await updateAgent(createResult.data.id, { name: 'Updated' });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe('Updated');
			}
		});

		it('updates enabledToolNames', async () => {
			const createResult = await createAgent({
				name: 'Agent',
				description: '',
				enabledToolNames: ['tool1']
			});
			expect(createResult.success).toBe(true);
			if (!createResult.success) return;

			const result = await updateAgent(createResult.data.id, {
				enabledToolNames: ['tool1', 'tool2', 'tool3']
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.enabledToolNames).toEqual(['tool1', 'tool2', 'tool3']);
			}
		});

		it('updates updatedAt timestamp', async () => {
			const createResult = await createAgent({ name: 'Agent', description: '' });
			expect(createResult.success).toBe(true);
			if (!createResult.success) return;

			const originalUpdatedAt = createResult.data.updatedAt.getTime();

			// Small delay to ensure timestamp differs
			await new Promise((r) => setTimeout(r, 10));

			const result = await updateAgent(createResult.data.id, { description: 'new description' });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
			}
		});

		it('returns error for non-existent agent', async () => {
			const result = await updateAgent('non-existent-id', { name: 'Updated' });

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('not found');
			}
		});
	});

	describe('deleteAgent', () => {
		it('removes agent from database', async () => {
			const createResult = await createAgent({ name: 'To Delete', description: '' });
			expect(createResult.success).toBe(true);
			if (!createResult.success) return;

			const deleteResult = await deleteAgent(createResult.data.id);
			expect(deleteResult.success).toBe(true);

			const getResult = await getAgent(createResult.data.id);
			expect(getResult.success).toBe(true);
			if (getResult.success) {
				expect(getResult.data).toBeNull();
			}
		});

		it('removes project-agent associations', async () => {
			const createResult = await createAgent({ name: 'Agent', description: '' });
			expect(createResult.success).toBe(true);
			if (!createResult.success) return;

			const projectId = generateId();
			await assignAgentToProject(createResult.data.id, projectId);

			// Verify assignment exists
			let agents = await getAgentsForProject(projectId);
			expect(agents.success).toBe(true);
			if (agents.success) {
				expect(agents.data.length).toBe(1);
			}

			// Delete agent
			await deleteAgent(createResult.data.id);

			// Verify association removed
			agents = await getAgentsForProject(projectId);
			expect(agents.success).toBe(true);
			if (agents.success) {
				expect(agents.data.length).toBe(0);
			}
		});
	});

	describe('project-agent relationships', () => {
		it('assigns agent to project', async () => {
			const agentResult = await createAgent({ name: 'Agent', description: '' });
			expect(agentResult.success).toBe(true);
			if (!agentResult.success) return;

			const projectId = generateId();
			const assignResult = await assignAgentToProject(agentResult.data.id, projectId);

			expect(assignResult.success).toBe(true);
		});

		it('removes agent from project', async () => {
			const agentResult = await createAgent({ name: 'Agent', description: '' });
			expect(agentResult.success).toBe(true);
			if (!agentResult.success) return;

			const projectId = generateId();
			await assignAgentToProject(agentResult.data.id, projectId);

			const removeResult = await removeAgentFromProject(agentResult.data.id, projectId);
			expect(removeResult.success).toBe(true);

			const agents = await getAgentsForProject(projectId);
			expect(agents.success).toBe(true);
			if (agents.success) {
				expect(agents.data.length).toBe(0);
			}
		});

		it('gets agents for project', async () => {
			const agent1 = await createAgent({ name: 'Agent 1', description: '' });
			const agent2 = await createAgent({ name: 'Agent 2', description: '' });
			const agent3 = await createAgent({ name: 'Agent 3', description: '' });
			expect(agent1.success && agent2.success && agent3.success).toBe(true);
			if (!agent1.success || !agent2.success || !agent3.success) return;

			const projectId = generateId();
			const otherProjectId = generateId();

			await assignAgentToProject(agent1.data.id, projectId);
			await assignAgentToProject(agent2.data.id, projectId);
			await assignAgentToProject(agent3.data.id, otherProjectId);

			const result = await getAgentsForProject(projectId);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.length).toBe(2);
				const names = result.data.map((a) => a.name).sort();
				expect(names).toEqual(['Agent 1', 'Agent 2']);
			}
		});

		it('prevents duplicate assignments', async () => {
			const agentResult = await createAgent({ name: 'Agent', description: '' });
			expect(agentResult.success).toBe(true);
			if (!agentResult.success) return;

			const projectId = generateId();
			await assignAgentToProject(agentResult.data.id, projectId);
			await assignAgentToProject(agentResult.data.id, projectId); // Duplicate

			const agents = await getAgentsForProject(projectId);
			expect(agents.success).toBe(true);
			if (agents.success) {
				// Should still be only one assignment
				expect(agents.data.length).toBe(1);
			}
		});

		it('returns empty array for project with no agents', async () => {
			const projectId = generateId();
			const result = await getAgentsForProject(projectId);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual([]);
			}
		});
	});
});
