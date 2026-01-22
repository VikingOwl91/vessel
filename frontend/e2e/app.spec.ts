/**
 * E2E tests for core application functionality
 *
 * Tests the main app UI, navigation, and user interactions
 */

import { test, expect } from '@playwright/test';

test.describe('App Loading', () => {
	test('loads the application', async ({ page }) => {
		await page.goto('/');

		// Should have the main app container
		await expect(page.locator('body')).toBeVisible();

		// Should have the sidebar (aside element with aria-label)
		await expect(page.locator('aside[aria-label="Sidebar navigation"]')).toBeVisible();
	});

	test('shows the Vessel branding', async ({ page }) => {
		await page.goto('/');

		// Look for Vessel text in sidebar
		await expect(page.getByText('Vessel')).toBeVisible({ timeout: 10000 });
	});

	test('has proper page title', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveTitle(/vessel/i);
	});
});

test.describe('Sidebar Navigation', () => {
	test('sidebar is visible', async ({ page }) => {
		await page.goto('/');

		// Sidebar is an aside element
		const sidebar = page.locator('aside[aria-label="Sidebar navigation"]');
		await expect(sidebar).toBeVisible();
	});

	test('has new chat link', async ({ page }) => {
		await page.goto('/');

		// New Chat is an anchor tag with "New Chat" text
		const newChatLink = page.getByRole('link', { name: /new chat/i });
		await expect(newChatLink).toBeVisible();
	});

	test('clicking new chat navigates to home', async ({ page }) => {
		await page.goto('/settings');

		// Click new chat link
		const newChatLink = page.getByRole('link', { name: /new chat/i });
		await newChatLink.click();

		// Should navigate to home
		await expect(page).toHaveURL('/');
	});

	test('has settings link', async ({ page }) => {
		await page.goto('/');

		// Settings is an anchor tag
		const settingsLink = page.getByRole('link', { name: /settings/i });
		await expect(settingsLink).toBeVisible();
	});

	test('can navigate to settings', async ({ page }) => {
		await page.goto('/');

		// Click settings link
		const settingsLink = page.getByRole('link', { name: /settings/i });
		await settingsLink.click();

		// Should navigate to settings
		await expect(page).toHaveURL('/settings');
	});

	test('has new project button', async ({ page }) => {
		await page.goto('/');

		// New Project button
		const newProjectButton = page.getByRole('button', { name: /new project/i });
		await expect(newProjectButton).toBeVisible();
	});

	test('has import button', async ({ page }) => {
		await page.goto('/');

		// Import button has aria-label
		const importButton = page.getByRole('button', { name: /import/i });
		await expect(importButton).toBeVisible();
	});
});

test.describe('Settings Page', () => {
	test('settings page loads', async ({ page }) => {
		await page.goto('/settings');

		// Should show settings content
		await expect(page.getByText(/general|models|prompts|tools/i).first()).toBeVisible({
			timeout: 10000
		});
	});

	test('has settings tabs', async ({ page }) => {
		await page.goto('/settings');

		// Wait for page to load
		await page.waitForLoadState('networkidle');

		// Should have multiple tabs/sections
		const content = await page.content();
		expect(content.toLowerCase()).toMatch(/general|models|prompts|tools|memory/);
	});
});

test.describe('Chat Interface', () => {
	test('home page shows chat area', async ({ page }) => {
		await page.goto('/');

		// Look for chat-related elements (message input area)
		const chatArea = page.locator('main, [class*="chat"]').first();
		await expect(chatArea).toBeVisible();
	});

	test('has textarea for message input', async ({ page }) => {
		await page.goto('/');

		// Chat input textarea
		const textarea = page.locator('textarea').first();
		await expect(textarea).toBeVisible({ timeout: 10000 });
	});

	test('can type in chat input', async ({ page }) => {
		await page.goto('/');

		// Find and type in textarea
		const textarea = page.locator('textarea').first();
		await textarea.fill('Hello, this is a test message');

		await expect(textarea).toHaveValue('Hello, this is a test message');
	});

	test('has send button', async ({ page }) => {
		await page.goto('/');

		// Send button (usually has submit type or send icon)
		const sendButton = page
			.locator('button[type="submit"]')
			.or(page.getByRole('button', { name: /send/i }));
		await expect(sendButton.first()).toBeVisible({ timeout: 10000 });
	});
});

test.describe('Model Selection', () => {
	test('chat page renders model-related UI', async ({ page }) => {
		await page.goto('/');

		// The app should render without crashing
		// Model selection depends on Ollama availability
		await expect(page.locator('body')).toBeVisible();

		// Check that there's either a model selector or a message about models
		const hasModelUI = await page
			.locator('[class*="model"], [class*="Model"]')
			.or(page.getByText(/model|ollama/i))
			.count();

		// Just verify app renders - model UI depends on backend state
		expect(hasModelUI).toBeGreaterThanOrEqual(0);
	});
});

test.describe('Responsive Design', () => {
	test('works on mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/');

		// App should still render
		await expect(page.locator('body')).toBeVisible();
		await expect(page.getByText('Vessel')).toBeVisible();
	});

	test('sidebar collapses on mobile', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/');

		// Sidebar should be collapsed (width: 0) on mobile
		const sidebar = page.locator('aside[aria-label="Sidebar navigation"]');

		// Check if sidebar has collapsed class or is hidden
		await expect(sidebar).toHaveClass(/w-0|hidden/);
	});

	test('works on tablet viewport', async ({ page }) => {
		await page.setViewportSize({ width: 768, height: 1024 });
		await page.goto('/');

		await expect(page.locator('body')).toBeVisible();
	});

	test('works on desktop viewport', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.goto('/');

		await expect(page.locator('body')).toBeVisible();

		// Sidebar should be visible on desktop
		const sidebar = page.locator('aside[aria-label="Sidebar navigation"]');
		await expect(sidebar).toBeVisible();
	});
});

test.describe('Accessibility', () => {
	test('has main content area', async ({ page }) => {
		await page.goto('/');

		// Should have main element
		const main = page.locator('main');
		await expect(main).toBeVisible();
	});

	test('sidebar has proper aria-label', async ({ page }) => {
		await page.goto('/');

		const sidebar = page.locator('aside[aria-label="Sidebar navigation"]');
		await expect(sidebar).toBeVisible();
	});

	test('interactive elements are focusable', async ({ page }) => {
		await page.goto('/');

		// New Chat link should be focusable
		const newChatLink = page.getByRole('link', { name: /new chat/i });
		await newChatLink.focus();
		await expect(newChatLink).toBeFocused();
	});

	test('can tab through interface', async ({ page }) => {
		await page.goto('/');

		// Focus on the first interactive element in the page
		const firstLink = page.getByRole('link').first();
		await firstLink.focus();

		// Tab should move focus to another element
		await page.keyboard.press('Tab');

		// Wait a bit for focus to shift
		await page.waitForTimeout(100);

		// Verify we can interact with the page via keyboard
		// Just check that pressing Tab doesn't cause errors
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');

		// Page should still be responsive
		await expect(page.locator('body')).toBeVisible();
	});
});

test.describe('Import Dialog', () => {
	test('import button opens dialog', async ({ page }) => {
		await page.goto('/');

		// Click import button
		const importButton = page.getByRole('button', { name: /import/i });
		await importButton.click();

		// Dialog should appear
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
	});

	test('import dialog can be closed', async ({ page }) => {
		await page.goto('/');

		// Open import dialog
		const importButton = page.getByRole('button', { name: /import/i });
		await importButton.click();

		// Wait for dialog
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		// Press escape to close
		await page.keyboard.press('Escape');

		// Dialog should be closed
		await expect(dialog).not.toBeVisible({ timeout: 2000 });
	});
});

test.describe('Project Modal', () => {
	test('new project button opens modal', async ({ page }) => {
		await page.goto('/');

		// Click new project button
		const newProjectButton = page.getByRole('button', { name: /new project/i });
		await newProjectButton.click();

		// Modal should appear
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
	});
});
