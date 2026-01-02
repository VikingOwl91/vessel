/**
 * Tool system type definitions
 * Compatible with Ollama's tool calling format
 */

/** JSON Schema for tool parameters */
export interface JSONSchema {
	type: 'object' | 'string' | 'number' | 'boolean' | 'array';
	properties?: Record<string, JSONSchemaProperty>;
	required?: string[];
	description?: string;
}

export interface JSONSchemaProperty {
	type: 'string' | 'number' | 'boolean' | 'array' | 'object';
	description?: string;
	enum?: string[];
	items?: JSONSchemaProperty;
	default?: unknown;
}

/** Tool definition (Ollama format) */
export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: JSONSchema;
	};
}

/** Tool call from model response */
export interface ToolCall {
	id: string;
	function: {
		name: string;
		arguments: string; // JSON string
	};
}

/** Parsed tool call with typed arguments */
export interface ParsedToolCall<T = Record<string, unknown>> {
	id: string;
	name: string;
	arguments: T;
}

/** Tool execution result */
export interface ToolResult {
	toolCallId: string;
	success: boolean;
	result?: unknown;
	error?: string;
}

/** Tool implementation type */
export type ToolImplementation = 'builtin' | 'javascript' | 'python' | 'http';

/** Custom tool configuration */
export interface CustomTool {
	id: string;
	name: string;
	description: string;
	parameters: JSONSchema;
	implementation: ToolImplementation;
	/** Code for 'javascript' or 'python' implementation */
	code?: string;
	/** HTTP endpoint for 'http' implementation */
	endpoint?: string;
	/** HTTP method for 'http' implementation */
	httpMethod?: 'GET' | 'POST';
	/** Whether the tool is enabled */
	enabled: boolean;
	/** Creation timestamp */
	createdAt: Date;
	/** Last update timestamp */
	updatedAt: Date;
}

/** Built-in tool handler function */
export type BuiltinToolHandler<T = Record<string, unknown>> = (
	args: T
) => Promise<unknown> | unknown;

/** Tool registry entry */
export interface ToolRegistryEntry {
	definition: ToolDefinition;
	handler: BuiltinToolHandler;
	isBuiltin: boolean;
}

/** Tool execution context */
export interface ToolContext {
	/** Conversation ID if in a chat context */
	conversationId?: string;
	/** User ID if authenticated */
	userId?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/** Tool call status for UI display */
export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

/** Tool call display state */
export interface ToolCallState {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	status: ToolCallStatus;
	result?: unknown;
	error?: string;
	startTime: number;
	endTime?: number;
}
