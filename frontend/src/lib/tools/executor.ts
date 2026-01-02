/**
 * Tool Executor - Handles running tools and managing results
 */

import type {
	ToolCall,
	ParsedToolCall,
	ToolResult,
	ToolRegistryEntry,
	ToolDefinition,
	ToolContext,
	ToolCallState,
	CustomTool
} from './types.js';
import { builtinTools, getBuiltinToolDefinitions } from './builtin.js';

/**
 * Execute a custom JavaScript tool
 *
 * SECURITY NOTE: This intentionally executes user-provided JavaScript code.
 * This is by design - users create custom tools with their own code.
 * The code runs in the browser context with the user's own permissions.
 * This is similar to browser DevTools console - users execute their own code.
 */
async function executeJavaScriptTool(tool: CustomTool, args: Record<string, unknown>): Promise<unknown> {
	if (!tool.code) {
		throw new Error('JavaScript tool has no code');
	}

	try {
		// Create an async function to support await in tool code
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
		const fn = new AsyncFunction('args', `
			"use strict";
			${tool.code}
		`);
		return await fn(args);
	} catch (error) {
		throw new Error(`Tool execution error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Execute a custom Python tool via backend API
 *
 * SECURITY NOTE: This sends user-provided Python code to the backend for execution.
 * This is by design - users create custom tools with their own code.
 * The backend executes code in a subprocess with timeout protection.
 */
async function executePythonTool(tool: CustomTool, args: Record<string, unknown>): Promise<unknown> {
	if (!tool.code) {
		throw new Error('Python tool has no code');
	}

	try {
		const response = await fetch('/api/v1/tools/execute', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				language: 'python',
				code: tool.code,
				args,
				timeout: 30
			})
		});

		if (!response.ok) {
			throw new Error(`Backend error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		if (!data.success) {
			throw new Error(data.error || 'Python execution failed');
		}

		return data.result;
	} catch (error) {
		throw new Error(`Python tool error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Execute a custom HTTP tool
 */
async function executeHttpTool(tool: CustomTool, args: Record<string, unknown>): Promise<unknown> {
	if (!tool.endpoint) {
		throw new Error('HTTP tool has no endpoint');
	}

	const method = tool.httpMethod || 'POST';
	const url = new URL(tool.endpoint);

	const options: RequestInit = {
		method,
		headers: {
			'Content-Type': 'application/json'
		}
	};

	if (method === 'GET') {
		// Add args as query parameters
		for (const [key, value] of Object.entries(args)) {
			url.searchParams.set(key, String(value));
		}
	} else {
		options.body = JSON.stringify(args);
	}

	const response = await fetch(url.toString(), options);

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const contentType = response.headers.get('content-type');
	if (contentType?.includes('application/json')) {
		return response.json();
	}
	return response.text();
}

/**
 * Tool Registry - Manages all available tools (builtin + custom)
 */
class ToolRegistry {
	private tools: Map<string, ToolRegistryEntry> = new Map();

	constructor() {
		// Initialize with builtin tools
		for (const [name, entry] of builtinTools) {
			this.tools.set(name, entry);
		}
	}

	/**
	 * Register a custom tool
	 */
	register(name: string, entry: ToolRegistryEntry): void {
		this.tools.set(name, entry);
	}

	/**
	 * Unregister a tool
	 */
	unregister(name: string): boolean {
		const entry = this.tools.get(name);
		if (entry?.isBuiltin) {
			return false; // Cannot unregister builtin tools
		}
		return this.tools.delete(name);
	}

	/**
	 * Get a tool by name
	 */
	get(name: string): ToolRegistryEntry | undefined {
		return this.tools.get(name);
	}

	/**
	 * Check if a tool exists
	 */
	has(name: string): boolean {
		return this.tools.has(name);
	}

	/**
	 * Get all tool definitions (for Ollama API)
	 */
	getDefinitions(): ToolDefinition[] {
		return Array.from(this.tools.values()).map(entry => entry.definition);
	}

	/**
	 * Get builtin tool definitions only
	 */
	getBuiltinDefinitions(): ToolDefinition[] {
		return getBuiltinToolDefinitions();
	}

	/**
	 * Get all tool names
	 */
	getNames(): string[] {
		return Array.from(this.tools.keys());
	}

	/**
	 * Get count of registered tools
	 */
	get size(): number {
		return this.tools.size;
	}
}

/** Singleton registry instance */
export const toolRegistry = new ToolRegistry();

/**
 * Execute a custom tool by its definition
 */
export async function executeCustomTool(
	tool: CustomTool,
	args: Record<string, unknown>
): Promise<unknown> {
	switch (tool.implementation) {
		case 'javascript':
			return executeJavaScriptTool(tool, args);
		case 'python':
			return executePythonTool(tool, args);
		case 'http':
			return executeHttpTool(tool, args);
		default:
			throw new Error(`Unknown implementation type: ${tool.implementation}`);
	}
}

/**
 * Parse a tool call from model response
 */
export function parseToolCall(call: ToolCall): ParsedToolCall {
	let args: Record<string, unknown> = {};

	try {
		args = JSON.parse(call.function.arguments);
	} catch {
		// If JSON parsing fails, try to extract as simple value
		args = { value: call.function.arguments };
	}

	return {
		id: call.id,
		name: call.function.name,
		arguments: args
	};
}

/**
 * Run a single tool call
 * @param call - The tool call from the model
 * @param context - Optional execution context
 * @param customTools - Optional array of custom tools to check
 */
export async function runToolCall(
	call: ToolCall | ParsedToolCall,
	context?: ToolContext,
	customTools?: CustomTool[]
): Promise<ToolResult> {
	const parsed = 'function' in call ? parseToolCall(call) : call;
	const { id, name, arguments: args } = parsed;

	// First check builtin tools in registry
	const entry = toolRegistry.get(name);
	if (entry) {
		try {
			const result = await entry.handler(args);

			// Check if result is an error object
			if (result && typeof result === 'object' && 'error' in result) {
				const errorObj = result as { error: unknown; suggestion?: string };
				// Include suggestion in error message if present
				const errorMsg = errorObj.suggestion
					? `${String(errorObj.error)}. ${errorObj.suggestion}`
					: String(errorObj.error);
				return {
					toolCallId: id,
					success: false,
					error: errorMsg
				};
			}

			return {
				toolCallId: id,
				success: true,
				result
			};
		} catch (error) {
			return {
				toolCallId: id,
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error during tool execution'
			};
		}
	}

	// Check custom tools
	if (customTools) {
		const customTool = customTools.find(t => t.name === name && t.enabled);
		if (customTool) {
			try {
				const result = await executeCustomTool(customTool, args);
				return {
					toolCallId: id,
					success: true,
					result
				};
			} catch (error) {
				return {
					toolCallId: id,
					success: false,
					error: error instanceof Error ? error.message : 'Custom tool execution failed'
				};
			}
		}
	}

	return {
		toolCallId: id,
		success: false,
		error: `Unknown tool: ${name}`
	};
}

/**
 * Run multiple tool calls in parallel
 */
export async function runToolCalls(
	calls: (ToolCall | ParsedToolCall)[],
	context?: ToolContext,
	customTools?: CustomTool[]
): Promise<ToolResult[]> {
	return Promise.all(calls.map(call => runToolCall(call, context, customTools)));
}

/**
 * Format tool results for inclusion in chat message
 */
export function formatToolResultsForChat(results: ToolResult[]): string {
	return results
		.map(result => {
			if (result.success) {
				const value = typeof result.result === 'object'
					? JSON.stringify(result.result, null, 2)
					: String(result.result);
				return `Tool result: ${value}`;
			} else {
				return `Tool error: ${result.error}`;
			}
		})
		.join('\n\n');
}

/**
 * Create a tool call state for UI tracking
 */
export function createToolCallState(call: ToolCall | ParsedToolCall): ToolCallState {
	const parsed = 'function' in call ? parseToolCall(call) : call;
	return {
		id: parsed.id,
		name: parsed.name,
		arguments: parsed.arguments,
		status: 'pending',
		startTime: Date.now()
	};
}

/**
 * Update tool call state with result
 */
export function updateToolCallState(
	state: ToolCallState,
	result: ToolResult
): ToolCallState {
	return {
		...state,
		status: result.success ? 'success' : 'error',
		result: result.result,
		error: result.error,
		endTime: Date.now()
	};
}
