/**
 * Vitest test setup
 * Configures the testing environment with necessary mocks and utilities
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Mock navigator for platform detection
Object.defineProperty(globalThis, 'navigator', {
	value: {
		platform: 'MacIntel', // Default to Mac for consistent tests
		userAgent: 'Mozilla/5.0 (Macintosh)'
	},
	writable: true,
	configurable: true
});

// Mock window if not present
if (typeof window === 'undefined') {
	// @ts-expect-error - Minimal window mock for Node environment
	globalThis.window = globalThis;
}

// Track event listeners for cleanup
const eventListeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

// Store original methods
const originalAddEventListener = window.addEventListener.bind(window);
const originalRemoveEventListener = window.removeEventListener.bind(window);

// Override addEventListener to track listeners (use type assertion for simplified signature)
(window as Window).addEventListener = function(
	type: string,
	listener: EventListenerOrEventListenerObject | null,
	options?: boolean | AddEventListenerOptions
): void {
	if (listener) {
		if (!eventListeners.has(type)) {
			eventListeners.set(type, new Set());
		}
		eventListeners.get(type)!.add(listener);
	}
	originalAddEventListener(type, listener as EventListener, options);
};

(window as Window).removeEventListener = function(
	type: string,
	listener: EventListenerOrEventListenerObject | null,
	options?: boolean | EventListenerOptions
): void {
	if (listener) {
		eventListeners.get(type)?.delete(listener);
	}
	originalRemoveEventListener(type, listener as EventListener, options);
};

// Helper to dispatch keyboard events
export function dispatchKeyboardEvent(
	key: string,
	options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...options
	});
	window.dispatchEvent(event);
	return event;
}

// Helper to simulate keyboard shortcut
export function pressShortcut(
	key: string,
	modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): KeyboardEvent {
	return dispatchKeyboardEvent(key, {
		ctrlKey: modifiers.ctrl ?? false,
		altKey: modifiers.alt ?? false,
		shiftKey: modifiers.shift ?? false,
		metaKey: modifiers.meta ?? false
	});
}

// Helper to simulate keyboard event on specific element
export function pressKeyOn(
	element: HTMLElement,
	key: string,
	modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): KeyboardEvent {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		ctrlKey: modifiers.ctrl ?? false,
		altKey: modifiers.alt ?? false,
		shiftKey: modifiers.shift ?? false,
		metaKey: modifiers.meta ?? false
	});
	element.dispatchEvent(event);
	return event;
}

// Helper to set platform
export function setPlatform(platform: 'mac' | 'windows' | 'linux'): void {
	const platforms: Record<string, string> = {
		mac: 'MacIntel',
		windows: 'Win32',
		linux: 'Linux x86_64'
	};
	Object.defineProperty(navigator, 'platform', {
		value: platforms[platform],
		writable: true,
		configurable: true
	});
}

// Reset keyboard manager state between tests
beforeEach(() => {
	// Reset platform to Mac by default
	setPlatform('mac');
});

afterEach(() => {
	// Clear all event listeners
	eventListeners.forEach((listeners, type) => {
		listeners.forEach(listener => {
			originalRemoveEventListener(type, listener);
		});
		listeners.clear();
	});
	vi.clearAllMocks();
});
