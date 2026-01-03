/**
 * Tools state management using Svelte 5 runes
 * Manages enabled tools and custom tool definitions
 */

import { toolRegistry, getBuiltinToolDefinitions } from '$lib/tools';
import type { ToolDefinition, CustomTool } from '$lib/tools';

/** Tool enable state (persisted to localStorage) */
interface ToolEnableState {
	[toolName: string]: boolean;
}

/** Tools state class with reactive properties */
class ToolsState {
	/** Which tools are currently enabled */
	enabledTools = $state<ToolEnableState>({});

	/** Custom tools created by the user */
	customTools = $state<CustomTool[]>([]);

	/** Whether tools are enabled for chat */
	toolsEnabled = $state(true);

	constructor() {
		// Load persisted state on initialization
		if (typeof window !== 'undefined') {
			this.loadFromStorage();
		}
	}

	/**
	 * Load state from localStorage
	 */
	private loadFromStorage(): void {
		try {
			const enabledState = localStorage.getItem('toolsEnabled');
			if (enabledState !== null) {
				this.toolsEnabled = enabledState === 'true';
			}

			const enabledTools = localStorage.getItem('enabledTools');
			if (enabledTools) {
				this.enabledTools = JSON.parse(enabledTools);
			} else {
				// Default: all builtin tools enabled
				for (const def of getBuiltinToolDefinitions()) {
					this.enabledTools[def.function.name] = true;
				}
			}

			const customTools = localStorage.getItem('customTools');
			if (customTools) {
				this.customTools = JSON.parse(customTools);
			}
		} catch (error) {
			console.error('Failed to load tools state from storage:', error);
		}
	}

	/**
	 * Save state to localStorage
	 */
	private saveToStorage(): void {
		try {
			localStorage.setItem('toolsEnabled', String(this.toolsEnabled));
			localStorage.setItem('enabledTools', JSON.stringify(this.enabledTools));
			localStorage.setItem('customTools', JSON.stringify(this.customTools));
		} catch (error) {
			console.error('Failed to save tools state to storage:', error);
		}
	}

	/**
	 * Toggle global tools enabled state
	 */
	toggleToolsEnabled(): void {
		this.toolsEnabled = !this.toolsEnabled;
		this.saveToStorage();
	}

	/**
	 * Enable or disable a specific tool
	 */
	setToolEnabled(toolName: string, enabled: boolean): void {
		this.enabledTools[toolName] = enabled;
		this.saveToStorage();
	}

	/**
	 * Toggle a specific tool's enabled state
	 */
	toggleTool(toolName: string): void {
		this.enabledTools[toolName] = !this.enabledTools[toolName];
		this.saveToStorage();
	}

	/**
	 * Check if a tool is enabled
	 */
	isToolEnabled(toolName: string): boolean {
		return this.enabledTools[toolName] ?? true;
	}

	/**
	 * Get all enabled tool definitions for Ollama API
	 */
	getEnabledToolDefinitions(): ToolDefinition[] {
		if (!this.toolsEnabled) {
			return [];
		}

		// Get enabled builtin tools
		const builtinDefs = toolRegistry.getDefinitions();
		const enabled = builtinDefs.filter(def => this.isToolEnabled(def.function.name));

		// Add enabled custom tools
		for (const custom of this.customTools) {
			if (custom.enabled && this.isToolEnabled(custom.name)) {
				enabled.push({
					type: 'function',
					function: {
						name: custom.name,
						description: custom.description,
						parameters: custom.parameters
					}
				});
			}
		}

		return enabled;
	}

	/**
	 * Get all tool definitions with their enabled state
	 */
	getAllToolsWithState(): Array<{ definition: ToolDefinition; enabled: boolean; isBuiltin: boolean }> {
		const result: Array<{ definition: ToolDefinition; enabled: boolean; isBuiltin: boolean }> = [];

		// Add builtin tools
		for (const def of getBuiltinToolDefinitions()) {
			result.push({
				definition: def,
				enabled: this.isToolEnabled(def.function.name),
				isBuiltin: true
			});
		}

		// Add custom tools
		for (const custom of this.customTools) {
			const def: ToolDefinition = {
				type: 'function',
				function: {
					name: custom.name,
					description: custom.description,
					parameters: custom.parameters
				}
			};
			result.push({
				definition: def,
				enabled: custom.enabled && this.isToolEnabled(custom.name),
				isBuiltin: false
			});
		}

		return result;
	}

	/**
	 * Add a custom tool
	 */
	addCustomTool(tool: Omit<CustomTool, 'id' | 'createdAt' | 'updatedAt'>): CustomTool {
		const newTool: CustomTool = {
			...tool,
			id: crypto.randomUUID(),
			createdAt: new Date(),
			updatedAt: new Date()
		};

		this.customTools = [...this.customTools, newTool];
		this.enabledTools[newTool.name] = newTool.enabled;
		this.saveToStorage();

		return newTool;
	}

	/**
	 * Update a custom tool
	 */
	updateCustomTool(id: string, updates: Partial<CustomTool>): void {
		this.customTools = this.customTools.map(tool => {
			if (tool.id === id) {
				const updated = { ...tool, ...updates, updatedAt: new Date() };
				if (updates.name && updates.name !== tool.name) {
					// Update enabled state key if name changed
					delete this.enabledTools[tool.name];
					this.enabledTools[updates.name] = updated.enabled;
				}
				return updated;
			}
			return tool;
		});
		this.saveToStorage();
	}

	/**
	 * Remove a custom tool
	 */
	removeCustomTool(id: string): void {
		const tool = this.customTools.find(t => t.id === id);
		if (tool) {
			delete this.enabledTools[tool.name];
			this.customTools = this.customTools.filter(t => t.id !== id);
			this.saveToStorage();
		}
	}

	/**
	 * Get a custom tool by ID
	 */
	getCustomTool(id: string): CustomTool | undefined {
		return this.customTools.find(t => t.id === id);
	}
}

/** Singleton tools state instance */
export const toolsState = new ToolsState();
