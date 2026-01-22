/**
 * E2E tests for Agents feature
 *
 * Tests the agents UI in settings and chat integration
 */

import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
	test('settings page has agents tab', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Should show agents tab content - use exact match for the main heading
		await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible({
			timeout: 10000
		});
	});

	test('agents tab shows empty state initially', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Should show empty state message
		await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible({ timeout: 10000 });
	});

	test('has create agent button', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Should have create button in the header (not the empty state button)
		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await expect(createButton).toBeVisible({ timeout: 10000 });
	});

	test('can open create agent dialog', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Click create button (the one in the header)
		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		// Dialog should appear with form fields
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await expect(page.getByLabel('Name *')).toBeVisible();
	});

	test('can create new agent', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Open create dialog
		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		// Wait for dialog
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

		// Fill in agent details
		await page.getByLabel('Name *').fill('Test Agent');
		await page.getByLabel('Description').fill('A test agent for E2E testing');

		// Submit the form - use the submit button inside the dialog
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		// Dialog should close and agent should appear in the list
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByRole('heading', { name: 'Test Agent' })).toBeVisible({ timeout: 5000 });
	});

	test('can edit existing agent', async ({ page }) => {
		// First create an agent
		await page.goto('/settings?tab=agents');

		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Edit Me Agent');
		await page.getByLabel('Description').fill('Will be edited');

		// Submit via dialog button
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		// Wait for agent to appear
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Edit Me Agent')).toBeVisible({ timeout: 5000 });

		// Click edit button (aria-label)
		const editButton = page.getByRole('button', { name: 'Edit agent' });
		await editButton.click();

		// Edit the name in the dialog
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Edited Agent');

		// Save changes
		await dialog.getByRole('button', { name: 'Save Changes' }).click();

		// Should show updated name
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Edited Agent')).toBeVisible({ timeout: 5000 });
	});

	test('can delete agent', async ({ page }) => {
		// First create an agent
		await page.goto('/settings?tab=agents');

		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Delete Me Agent');
		await page.getByLabel('Description').fill('Will be deleted');

		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		// Wait for agent to appear
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Delete Me Agent')).toBeVisible({ timeout: 5000 });

		// Click delete button (aria-label)
		const deleteButton = page.getByRole('button', { name: 'Delete agent' });
		await deleteButton.click();

		// Confirm deletion in dialog - look for the Delete button in the confirm dialog
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		const confirmDialog = page.getByRole('dialog');
		await confirmDialog.getByRole('button', { name: 'Delete' }).click();

		// Agent should be removed
		await expect(page.getByRole('heading', { name: 'Delete Me Agent' })).not.toBeVisible({ timeout: 5000 });
	});

	test('can navigate to agents tab via navigation', async ({ page }) => {
		await page.goto('/settings');

		// Click on agents tab link
		const agentsTab = page.getByRole('link', { name: 'Agents' });
		await agentsTab.click();

		// URL should update
		await expect(page).toHaveURL(/tab=agents/);

		// Agents content should be visible
		await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
	});
});

test.describe('Agent Tool Selection', () => {
	test('can select tools for agent', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Open create dialog
		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Tool Agent');
		await page.getByLabel('Description').fill('Agent with specific tools');

		// Look for Allowed Tools section
		await expect(page.getByText('Allowed Tools', { exact: true })).toBeVisible({ timeout: 5000 });

		// Save the agent
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		// Agent should be created
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Tool Agent')).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Agent Prompt Selection', () => {
	test('can assign prompt to agent', async ({ page }) => {
		await page.goto('/settings?tab=agents');

		// Open create dialog
		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Prompt Agent');
		await page.getByLabel('Description').fill('Agent with a prompt');

		// Look for System Prompt selector
		await expect(page.getByLabel('System Prompt')).toBeVisible({ timeout: 5000 });

		// Save the agent
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		// Agent should be created
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Prompt Agent')).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Agent Chat Integration', () => {
	test('agent selector appears on home page', async ({ page }) => {
		await page.goto('/');

		// Agent selector button should be visible (shows "No agent" by default)
		await expect(page.getByRole('button', { name: /No agent/i })).toBeVisible({ timeout: 10000 });
	});

	test('agent selector dropdown shows "No agents" when none exist', async ({ page }) => {
		await page.goto('/');

		// Click on agent selector
		const agentButton = page.getByRole('button', { name: /No agent/i });
		await agentButton.click();

		// Should show "No agents available" message
		await expect(page.getByText('No agents available')).toBeVisible({ timeout: 5000 });

		// Should have link to create agents
		await expect(page.getByRole('link', { name: 'Create one' })).toBeVisible();
	});

	test('agent selector shows created agents', async ({ page }) => {
		// First create an agent
		await page.goto('/settings?tab=agents');

		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Chat Agent');
		await page.getByLabel('Description').fill('Agent for chat testing');

		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

		// Now go to home page and check agent selector
		await page.goto('/');

		const agentButton = page.getByRole('button', { name: /No agent/i });
		await agentButton.click();

		// Should show the created agent
		await expect(page.getByText('Chat Agent')).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Agent for chat testing')).toBeVisible();
	});

	test('can select agent from dropdown', async ({ page }) => {
		// First create an agent
		await page.goto('/settings?tab=agents');

		const createButton = page.getByRole('button', { name: 'Create Agent' }).first();
		await createButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await page.getByLabel('Name *').fill('Selectable Agent');
		await page.getByLabel('Description').fill('Can be selected');

		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Create Agent' }).click();

		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

		// Go to home page
		await page.goto('/');

		// Open agent selector
		const agentButton = page.getByRole('button', { name: /No agent/i });
		await agentButton.click();

		// Select the agent
		await page.getByText('Selectable Agent').click();

		// Button should now show the agent name
		await expect(page.getByRole('button', { name: /Selectable Agent/i })).toBeVisible({ timeout: 5000 });
	});
});
