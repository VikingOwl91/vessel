/**
 * Keyboard shortcuts tests
 *
 * Tests the keyboard shortcuts management system including:
 * - Platform detection
 * - Modifier key handling
 * - Shortcut registration and triggering
 * - Input field detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	keyboardShortcuts,
	isPrimaryModifier,
	getPrimaryModifierDisplay,
	formatShortcut,
	getShortcuts,
	_resetPlatformCache,
	type Shortcut
} from './keyboard';
import { setPlatform, pressShortcut, pressKeyOn } from '../../tests/setup';

// Helper to properly switch platforms (resets cache + sets navigator.platform)
function switchPlatform(platform: 'mac' | 'windows' | 'linux'): void {
	_resetPlatformCache();
	setPlatform(platform);
}

describe('keyboard.ts', () => {
	describe('Platform Detection', () => {
		it('detects Mac platform correctly', () => {
			switchPlatform('mac');
			const event = new KeyboardEvent('keydown', { metaKey: true });
			expect(isPrimaryModifier(event)).toBe(true);
		});

		it('detects Windows platform correctly (uses Alt)', () => {
			switchPlatform('windows');
			const event = new KeyboardEvent('keydown', { altKey: true });
			expect(isPrimaryModifier(event)).toBe(true);
		});

		it('detects Linux platform correctly (uses Alt)', () => {
			switchPlatform('linux');
			const event = new KeyboardEvent('keydown', { altKey: true });
			expect(isPrimaryModifier(event)).toBe(true);
		});
	});

	describe('isPrimaryModifier', () => {
		beforeEach(() => {
			switchPlatform('mac');
		});

		it('returns true for metaKey on Mac', () => {
			const event = new KeyboardEvent('keydown', { metaKey: true });
			expect(isPrimaryModifier(event)).toBe(true);
		});

		it('returns false for ctrlKey on Mac', () => {
			const event = new KeyboardEvent('keydown', { ctrlKey: true });
			expect(isPrimaryModifier(event)).toBe(false);
		});

		it('returns true for altKey on Windows', () => {
			switchPlatform('windows');
			const event = new KeyboardEvent('keydown', { altKey: true });
			expect(isPrimaryModifier(event)).toBe(true);
		});

		it('returns false for metaKey on Windows', () => {
			switchPlatform('windows');
			const event = new KeyboardEvent('keydown', { metaKey: true });
			expect(isPrimaryModifier(event)).toBe(false);
		});

		it('returns false for ctrlKey on Windows (browser shortcut conflict)', () => {
			switchPlatform('windows');
			const event = new KeyboardEvent('keydown', { ctrlKey: true });
			expect(isPrimaryModifier(event)).toBe(false);
		});
	});

	describe('getPrimaryModifierDisplay', () => {
		it('returns ⌘ on Mac', () => {
			switchPlatform('mac');
			expect(getPrimaryModifierDisplay()).toBe('⌘');
		});

		it('returns Alt on Windows', () => {
			switchPlatform('windows');
			expect(getPrimaryModifierDisplay()).toBe('Alt');
		});

		it('returns Alt on Linux', () => {
			switchPlatform('linux');
			expect(getPrimaryModifierDisplay()).toBe('Alt');
		});
	});

	describe('formatShortcut', () => {
		beforeEach(() => {
			switchPlatform('mac');
		});

		it('formats single key without modifiers', () => {
			expect(formatShortcut('Escape')).toBe('Escape');
		});

		it('formats key with meta modifier on Mac', () => {
			expect(formatShortcut('k', { meta: true })).toBe('⌘K');
		});

		it('formats key with ctrl modifier', () => {
			expect(formatShortcut('s', { ctrl: true })).toBe('CtrlS');
		});

		it('formats key with shift modifier on Mac', () => {
			expect(formatShortcut('n', { shift: true })).toBe('⇧N');
		});

		it('formats key with alt modifier on Mac', () => {
			expect(formatShortcut('p', { alt: true })).toBe('⌥P');
		});

		it('formats multiple modifiers', () => {
			expect(formatShortcut('z', { ctrl: true, shift: true })).toBe('Ctrl⇧Z');
		});

		it('formats with Windows-style on non-Mac', () => {
			switchPlatform('windows');
			expect(formatShortcut('k', { meta: true })).toBe('Win+K');
			expect(formatShortcut('s', { ctrl: true })).toBe('Ctrl+S');
			expect(formatShortcut('n', { shift: true })).toBe('Shift+N');
		});

		it('uppercases single character keys', () => {
			expect(formatShortcut('a')).toBe('A');
			expect(formatShortcut('z')).toBe('Z');
		});
	});

	describe('getShortcuts', () => {
		beforeEach(() => {
			switchPlatform('mac');
		});

		it('returns all predefined shortcuts', () => {
			const shortcuts = getShortcuts();
			expect(shortcuts).toHaveProperty('NEW_CHAT');
			expect(shortcuts).toHaveProperty('SEARCH');
			expect(shortcuts).toHaveProperty('TOGGLE_SIDENAV');
			expect(shortcuts).toHaveProperty('CLOSE_MODAL');
			expect(shortcuts).toHaveProperty('SEND_MESSAGE');
			expect(shortcuts).toHaveProperty('STOP_GENERATION');
		});

		it('NEW_CHAT has correct configuration', () => {
			const shortcuts = getShortcuts();
			expect(shortcuts.NEW_CHAT.id).toBe('new-chat');
			expect(shortcuts.NEW_CHAT.key).toBe('n');
			expect(shortcuts.NEW_CHAT.description).toBe('New chat');
		});

		it('uses meta modifier on Mac', () => {
			const shortcuts = getShortcuts();
			expect(shortcuts.NEW_CHAT.modifiers).toEqual({ meta: true });
			expect(shortcuts.SEARCH.modifiers).toEqual({ meta: true });
		});

		it('uses alt modifier on Windows (avoids browser shortcut conflicts)', () => {
			switchPlatform('windows');
			const shortcuts = getShortcuts();
			expect(shortcuts.NEW_CHAT.modifiers).toEqual({ alt: true });
			expect(shortcuts.SEARCH.modifiers).toEqual({ alt: true });
		});

		it('CLOSE_MODAL has no modifiers', () => {
			const shortcuts = getShortcuts();
			expect('modifiers' in shortcuts.CLOSE_MODAL).toBe(false);
			expect(shortcuts.CLOSE_MODAL.key).toBe('Escape');
		});
	});
});

describe('KeyboardShortcutsManager', () => {
	beforeEach(() => {
		switchPlatform('mac');
		keyboardShortcuts.destroy(); // Clean state
		keyboardShortcuts.initialize();
	});

	afterEach(() => {
		keyboardShortcuts.destroy();
	});

	describe('initialize and destroy', () => {
		it('initializes and attaches event listener', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-init',
				key: 'a',
				description: 'Test init',
				handler
			});

			pressShortcut('a');
			expect(handler).toHaveBeenCalled();
		});

		it('destroy removes event listener', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-destroy',
				key: 'b',
				description: 'Test destroy',
				handler
			});

			keyboardShortcuts.destroy();
			pressShortcut('b');
			expect(handler).not.toHaveBeenCalled();
		});

		it('clears shortcuts on destroy', () => {
			keyboardShortcuts.register({
				id: 'test-clear',
				key: 'c',
				description: 'Test clear',
				handler: vi.fn()
			});

			expect(keyboardShortcuts.getShortcuts()).toHaveLength(1);
			keyboardShortcuts.destroy();
			expect(keyboardShortcuts.getShortcuts()).toHaveLength(0);
		});
	});

	describe('register and unregister', () => {
		it('registers a shortcut', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-register',
				key: 'r',
				description: 'Test register',
				handler
			});

			const shortcuts = keyboardShortcuts.getShortcuts();
			expect(shortcuts).toHaveLength(1);
			expect(shortcuts[0].id).toBe('test-register');
		});

		it('unregisters a shortcut', () => {
			keyboardShortcuts.register({
				id: 'test-unregister',
				key: 'u',
				description: 'Test unregister',
				handler: vi.fn()
			});

			expect(keyboardShortcuts.getShortcuts()).toHaveLength(1);
			keyboardShortcuts.unregister('test-unregister');
			expect(keyboardShortcuts.getShortcuts()).toHaveLength(0);
		});

		it('shortcut is enabled by default', () => {
			keyboardShortcuts.register({
				id: 'test-enabled-default',
				key: 'e',
				description: 'Test enabled',
				handler: vi.fn()
			});

			const shortcut = keyboardShortcuts.getShortcuts()[0];
			expect(shortcut.enabled).toBe(true);
		});

		it('respects explicit enabled: false', () => {
			keyboardShortcuts.register({
				id: 'test-disabled',
				key: 'd',
				description: 'Test disabled',
				handler: vi.fn(),
				enabled: false
			});

			const shortcut = keyboardShortcuts.getShortcuts()[0];
			expect(shortcut.enabled).toBe(false);
		});
	});

	describe('shortcut triggering', () => {
		it('triggers handler on key press', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-trigger',
				key: 't',
				description: 'Test trigger',
				handler
			});

			pressShortcut('t');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('passes event to handler', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-event',
				key: 'e',
				description: 'Test event',
				handler
			});

			pressShortcut('e');
			expect(handler).toHaveBeenCalledWith(expect.any(KeyboardEvent));
		});

		it('triggers with correct modifier on Mac', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-mac-mod',
				key: 'm',
				modifiers: { meta: true },
				description: 'Test Mac modifier',
				handler
			});

			// Without modifier - should NOT trigger
			pressShortcut('m');
			expect(handler).not.toHaveBeenCalled();

			// With meta (Cmd) - should trigger
			pressShortcut('m', { meta: true });
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('triggers with correct modifier on Windows (Alt)', () => {
			switchPlatform('windows');
			keyboardShortcuts.destroy();
			keyboardShortcuts.initialize();

			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-win-mod',
				key: 'w',
				modifiers: { alt: true },
				description: 'Test Windows modifier',
				handler
			});

			// Without modifier - should NOT trigger
			pressShortcut('w');
			expect(handler).not.toHaveBeenCalled();

			// With alt - should trigger
			pressShortcut('w', { alt: true });
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('is case insensitive for keys', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-case',
				key: 'K',
				description: 'Test case',
				handler
			});

			pressShortcut('k');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('does not trigger for wrong key', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-wrong-key',
				key: 'x',
				description: 'Test wrong key',
				handler
			});

			pressShortcut('y');
			expect(handler).not.toHaveBeenCalled();
		});

		it('does not trigger for wrong modifiers', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-wrong-mod',
				key: 'z',
				modifiers: { meta: true, shift: true },
				description: 'Test wrong modifiers',
				handler
			});

			// Only meta, missing shift
			pressShortcut('z', { meta: true });
			expect(handler).not.toHaveBeenCalled();

			// Correct modifiers
			pressShortcut('z', { meta: true, shift: true });
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe('preventDefault behavior', () => {
		it('prevents default by default', () => {
			keyboardShortcuts.register({
				id: 'test-prevent-default',
				key: 'p',
				description: 'Test prevent default',
				handler: vi.fn()
			});

			const event = pressShortcut('p');
			expect(event.defaultPrevented).toBe(true);
		});

		it('does not prevent default when preventDefault: false', () => {
			keyboardShortcuts.register({
				id: 'test-no-prevent',
				key: 'n',
				description: 'Test no prevent',
				handler: vi.fn(),
				preventDefault: false
			});

			const event = pressShortcut('n');
			expect(event.defaultPrevented).toBe(false);
		});
	});

	describe('setEnabled', () => {
		it('disables a specific shortcut', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-disable',
				key: 'd',
				description: 'Test disable',
				handler
			});

			keyboardShortcuts.setEnabled('test-disable', false);

			pressShortcut('d');
			expect(handler).not.toHaveBeenCalled();
		});

		it('re-enables a disabled shortcut', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-reenable',
				key: 'r',
				description: 'Test reenable',
				handler
			});

			keyboardShortcuts.setEnabled('test-reenable', false);
			keyboardShortcuts.setEnabled('test-reenable', true);

			pressShortcut('r');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('handles non-existent shortcut gracefully', () => {
			// Should not throw
			expect(() => {
				keyboardShortcuts.setEnabled('non-existent', false);
			}).not.toThrow();
		});
	});

	describe('setGlobalEnabled', () => {
		it('disables all shortcuts when global disabled', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			keyboardShortcuts.register({
				id: 'test-global-1',
				key: 'a',
				description: 'Test global 1',
				handler: handler1
			});
			keyboardShortcuts.register({
				id: 'test-global-2',
				key: 'b',
				description: 'Test global 2',
				handler: handler2
			});

			keyboardShortcuts.setGlobalEnabled(false);

			pressShortcut('a');
			pressShortcut('b');

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});

		it('re-enables all shortcuts when global enabled', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-global-reenable',
				key: 'g',
				description: 'Test global reenable',
				handler
			});

			keyboardShortcuts.setGlobalEnabled(false);
			keyboardShortcuts.setGlobalEnabled(true);

			pressShortcut('g');
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe('input field detection', () => {
		it('does not trigger shortcuts when focused on input', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-input',
				key: 'i',
				description: 'Test input',
				handler
			});

			const input = document.createElement('input');
			document.body.appendChild(input);
			input.focus();

			pressKeyOn(input, 'i');
			expect(handler).not.toHaveBeenCalled();

			document.body.removeChild(input);
		});

		it('does not trigger shortcuts when focused on textarea', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-textarea',
				key: 't',
				description: 'Test textarea',
				handler
			});

			const textarea = document.createElement('textarea');
			document.body.appendChild(textarea);
			textarea.focus();

			pressKeyOn(textarea, 't');
			expect(handler).not.toHaveBeenCalled();

			document.body.removeChild(textarea);
		});

		it('does not trigger shortcuts when focused on contenteditable', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-contenteditable',
				key: 'c',
				description: 'Test contenteditable',
				handler
			});

			const div = document.createElement('div');
			div.contentEditable = 'true';
			// jsdom doesn't implement isContentEditable, so we need to mock it
			Object.defineProperty(div, 'isContentEditable', { value: true });
			document.body.appendChild(div);
			div.focus();

			pressKeyOn(div, 'c');
			expect(handler).not.toHaveBeenCalled();

			document.body.removeChild(div);
		});

		it('DOES trigger Escape even when focused on input', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-escape-input',
				key: 'Escape',
				description: 'Test Escape in input',
				handler
			});

			const input = document.createElement('input');
			document.body.appendChild(input);
			input.focus();

			pressKeyOn(input, 'Escape');
			expect(handler).toHaveBeenCalledTimes(1);

			document.body.removeChild(input);
		});

		it('DOES trigger Escape even when focused on textarea', () => {
			const handler = vi.fn();
			keyboardShortcuts.register({
				id: 'test-escape-textarea',
				key: 'Escape',
				description: 'Test Escape in textarea',
				handler
			});

			const textarea = document.createElement('textarea');
			document.body.appendChild(textarea);
			textarea.focus();

			pressKeyOn(textarea, 'Escape');
			expect(handler).toHaveBeenCalledTimes(1);

			document.body.removeChild(textarea);
		});
	});

	describe('multiple shortcuts', () => {
		it('only triggers matching shortcut', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const handler3 = vi.fn();

			keyboardShortcuts.register({
				id: 'multi-1',
				key: 'a',
				description: 'Multi 1',
				handler: handler1
			});
			keyboardShortcuts.register({
				id: 'multi-2',
				key: 'b',
				description: 'Multi 2',
				handler: handler2
			});
			keyboardShortcuts.register({
				id: 'multi-3',
				key: 'c',
				description: 'Multi 3',
				handler: handler3
			});

			pressShortcut('b');

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledTimes(1);
			expect(handler3).not.toHaveBeenCalled();
		});

		it('first registered shortcut wins on conflict', () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			keyboardShortcuts.register({
				id: 'conflict-1',
				key: 'x',
				description: 'Conflict 1',
				handler: handler1
			});
			keyboardShortcuts.register({
				id: 'conflict-2',
				key: 'x',
				description: 'Conflict 2',
				handler: handler2
			});

			pressShortcut('x');

			// First registered should trigger (Map iteration order)
			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe('getShortcuts', () => {
		it('returns all registered shortcuts', () => {
			keyboardShortcuts.register({
				id: 'get-1',
				key: 'a',
				description: 'Get 1',
				handler: vi.fn()
			});
			keyboardShortcuts.register({
				id: 'get-2',
				key: 'b',
				description: 'Get 2',
				handler: vi.fn()
			});

			const shortcuts = keyboardShortcuts.getShortcuts();
			expect(shortcuts).toHaveLength(2);
			expect(shortcuts.map(s => s.id)).toContain('get-1');
			expect(shortcuts.map(s => s.id)).toContain('get-2');
		});

		it('returns empty array when no shortcuts registered', () => {
			expect(keyboardShortcuts.getShortcuts()).toEqual([]);
		});
	});
});

describe('Real-world shortcut scenarios', () => {
	beforeEach(() => {
		switchPlatform('mac');
		keyboardShortcuts.destroy();
		keyboardShortcuts.initialize();
	});

	afterEach(() => {
		keyboardShortcuts.destroy();
	});

	it('Cmd+N creates new chat', () => {
		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.NEW_CHAT,
			handler
		});

		pressShortcut('n', { meta: true });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('Cmd+K opens search', () => {
		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.SEARCH,
			handler
		});

		pressShortcut('k', { meta: true });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('Cmd+B toggles sidenav', () => {
		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.TOGGLE_SIDENAV,
			handler
		});

		pressShortcut('b', { meta: true });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('Escape closes modal', () => {
		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.CLOSE_MODAL,
			handler
		});

		pressShortcut('Escape');
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('Alt+N works on Windows (avoids browser Ctrl+N conflict)', () => {
		switchPlatform('windows');
		keyboardShortcuts.destroy();
		keyboardShortcuts.initialize();

		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.NEW_CHAT,
			handler
		});

		// Alt+N should trigger (our shortcut)
		pressShortcut('n', { alt: true });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('Ctrl+N does NOT trigger on Windows (reserved by browser)', () => {
		switchPlatform('windows');
		keyboardShortcuts.destroy();
		keyboardShortcuts.initialize();

		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.NEW_CHAT,
			handler
		});

		// Ctrl+N should NOT trigger (browser opens new window)
		pressShortcut('n', { ctrl: true });
		expect(handler).not.toHaveBeenCalled();
	});

	it('prevents browser default for Cmd+K (spotlight search)', () => {
		const handler = vi.fn();
		const shortcuts = getShortcuts();
		keyboardShortcuts.register({
			...shortcuts.SEARCH,
			handler
		});

		const event = pressShortcut('k', { meta: true });
		expect(event.defaultPrevented).toBe(true);
	});
});
