/**
 * Keyboard shortcuts management
 *
 * Provides a centralized system for registering and handling keyboard shortcuts.
 */

/** Modifier keys */
export interface Modifiers {
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	meta?: boolean; // Cmd on Mac, Win on Windows
}

/** Shortcut definition */
export interface Shortcut {
	/** Unique identifier for the shortcut */
	id: string;
	/** The key to listen for (e.g., 'k', 'n', 'Escape') */
	key: string;
	/** Required modifier keys */
	modifiers?: Modifiers;
	/** Human-readable description */
	description: string;
	/** Handler function */
	handler: (event: KeyboardEvent) => void;
	/** Whether to prevent default behavior */
	preventDefault?: boolean;
	/** Whether the shortcut is currently enabled */
	enabled?: boolean;
}

/** Platform detection - evaluated lazily to work in browser */
function getIsMac(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/** Cached isMac value */
let _isMac: boolean | null = null;
const isMac = (): boolean => {
	if (_isMac === null) {
		_isMac = getIsMac();
	}
	return _isMac;
};

/**
 * Reset platform cache (for testing only)
 * @internal
 */
export function _resetPlatformCache(): void {
	_isMac = null;
}

/**
 * Check if the primary modifier is pressed (Cmd on Mac, Alt on others)
 */
export function isPrimaryModifier(event: KeyboardEvent): boolean {
	return isMac() ? event.metaKey : event.altKey;
}

/**
 * Get the display string for the primary modifier
 */
export function getPrimaryModifierDisplay(): string {
	return isMac() ? '⌘' : 'Alt';
}

/**
 * Format a shortcut for display
 */
export function formatShortcut(key: string, modifiers?: Modifiers): string {
	const parts: string[] = [];

	if (modifiers?.ctrl) parts.push('Ctrl');
	if (modifiers?.alt) parts.push(isMac() ? '⌥' : 'Alt');
	if (modifiers?.shift) parts.push(isMac() ? '⇧' : 'Shift');
	if (modifiers?.meta) parts.push(isMac() ? '⌘' : 'Win');

	// Format special keys
	const keyDisplay = key.length === 1 ? key.toUpperCase() : key;
	parts.push(keyDisplay);

	return parts.join(isMac() ? '' : '+');
}

/**
 * Check if modifiers match the event
 */
function modifiersMatch(event: KeyboardEvent, modifiers?: Modifiers): boolean {
	const ctrl = modifiers?.ctrl ?? false;
	const alt = modifiers?.alt ?? false;
	const shift = modifiers?.shift ?? false;
	const meta = modifiers?.meta ?? false;

	return (
		event.ctrlKey === ctrl &&
		event.altKey === alt &&
		event.shiftKey === shift &&
		event.metaKey === meta
	);
}

/**
 * Keyboard shortcuts manager
 */
class KeyboardShortcutsManager {
	private shortcuts: Map<string, Shortcut> = new Map();
	private enabled = true;
	private boundHandler: (event: KeyboardEvent) => void;

	constructor() {
		this.boundHandler = this.handleKeydown.bind(this);
	}

	/**
	 * Initialize the manager (call once in browser)
	 */
	initialize(): void {
		if (typeof window === 'undefined') return;
		window.addEventListener('keydown', this.boundHandler);
	}

	/**
	 * Destroy the manager
	 */
	destroy(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('keydown', this.boundHandler);
		this.shortcuts.clear();
	}

	/**
	 * Register a shortcut
	 */
	register(shortcut: Shortcut): void {
		this.shortcuts.set(shortcut.id, { ...shortcut, enabled: shortcut.enabled ?? true });
	}

	/**
	 * Unregister a shortcut
	 */
	unregister(id: string): void {
		this.shortcuts.delete(id);
	}

	/**
	 * Enable or disable a specific shortcut
	 */
	setEnabled(id: string, enabled: boolean): void {
		const shortcut = this.shortcuts.get(id);
		if (shortcut) {
			shortcut.enabled = enabled;
		}
	}

	/**
	 * Enable or disable all shortcuts
	 */
	setGlobalEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Get all registered shortcuts
	 */
	getShortcuts(): Shortcut[] {
		return Array.from(this.shortcuts.values());
	}

	/**
	 * Handle keydown events
	 */
	private handleKeydown(event: KeyboardEvent): void {
		if (!this.enabled) return;

		// Don't trigger shortcuts when typing in inputs (unless it's Escape)
		const target = event.target as HTMLElement;
		const isInput = target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable;

		if (isInput && event.key !== 'Escape') return;

		// Find matching shortcut
		for (const shortcut of this.shortcuts.values()) {
			if (!shortcut.enabled) continue;

			const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
			if (!keyMatches) continue;

			if (!modifiersMatch(event, shortcut.modifiers)) continue;

			// Found a match
			if (shortcut.preventDefault !== false) {
				event.preventDefault();
			}
			shortcut.handler(event);
			return;
		}
	}
}

/** Singleton instance */
export const keyboardShortcuts = new KeyboardShortcutsManager();

/**
 * Get platform-aware primary modifier
 * - Mac: Cmd (meta)
 * - Windows/Linux: Alt (because Ctrl+N/K/etc are browser shortcuts that can't be overridden)
 */
function getPrimaryModifiers(): Modifiers {
	return isMac() ? { meta: true } : { alt: true };
}

/**
 * Common shortcut definitions - function to ensure lazy evaluation
 */
export function getShortcuts() {
	return {
		NEW_CHAT: {
			id: 'new-chat',
			key: 'n',
			modifiers: getPrimaryModifiers(),
			description: 'New chat'
		},
		SEARCH: {
			id: 'search',
			key: 'k',
			modifiers: getPrimaryModifiers(),
			description: 'Search conversations'
		},
		TOGGLE_SIDENAV: {
			id: 'toggle-sidenav',
			key: 'b',
			modifiers: getPrimaryModifiers(),
			description: 'Toggle sidebar'
		},
		FOCUS_INPUT: {
			id: 'focus-input',
			key: '/',
			modifiers: getPrimaryModifiers(),
			description: 'Focus chat input'
		},
		SHOW_SHORTCUTS: {
			id: 'show-shortcuts',
			key: '?',
			modifiers: { shift: true },
			description: 'Show keyboard shortcuts'
		},
		CLOSE_MODAL: {
			id: 'close-modal',
			key: 'Escape',
			description: 'Close modal/dialog'
		},
		SEND_MESSAGE: {
			id: 'send-message',
			key: 'Enter',
			description: 'Send message'
		},
		STOP_GENERATION: {
			id: 'stop-generation',
			key: 'Escape',
			description: 'Stop generation'
		}
	} as const;
}
