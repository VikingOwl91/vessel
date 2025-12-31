/**
 * TypeScript types for Ollama API
 * Reference: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

// ============================================================================
// Model Types
// ============================================================================

/** Model details from Ollama API */
export interface OllamaModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[] | null;
	parameter_size: string;
	quantization_level: string;
}

/** Single model from Ollama API /api/tags response */
export interface OllamaModel {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details: OllamaModelDetails;
}

/** Response from Ollama /api/tags endpoint */
export interface OllamaModelsResponse {
	models: OllamaModel[];
}

/** Running model from /api/ps endpoint */
export interface OllamaRunningModel {
	name: string;
	model: string;
	size: number;
	digest: string;
	details: OllamaModelDetails;
	expires_at: string;
	size_vram: number;
}

/** Response from Ollama /api/ps endpoint */
export interface OllamaRunningModelsResponse {
	models: OllamaRunningModel[];
}

// ============================================================================
// Message Types
// ============================================================================

/** Role of a message in a chat conversation */
export type OllamaMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Tool call function definition in an assistant message */
export interface OllamaToolCallFunction {
	name: string;
	arguments: Record<string, unknown>;
}

/** Tool call in an assistant message */
export interface OllamaToolCall {
	function: OllamaToolCallFunction;
}

/** A single message in an Ollama chat conversation */
export interface OllamaMessage {
	role: OllamaMessageRole;
	content: string;
	/** Base64-encoded images for multimodal models */
	images?: string[];
	/** Tool calls made by the assistant */
	tool_calls?: OllamaToolCall[];
	/** Thinking/reasoning content from reasoning models (when think: true) */
	thinking?: string;
}

// ============================================================================
// Tool Definition Types
// ============================================================================

/** JSON Schema type for tool parameters */
export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

/** JSON Schema property definition */
export interface JsonSchemaProperty {
	type: JsonSchemaType;
	description?: string;
	enum?: string[];
	items?: JsonSchemaProperty;
	properties?: Record<string, JsonSchemaProperty>;
	required?: string[];
}

/** JSON Schema for tool parameters */
export interface JsonSchema {
	type: 'object';
	properties: Record<string, JsonSchemaProperty>;
	required?: string[];
}

/** Tool function definition */
export interface OllamaToolFunction {
	name: string;
	description: string;
	parameters: JsonSchema;
}

/** Tool definition for Ollama API */
export interface OllamaToolDefinition {
	type: 'function';
	function: OllamaToolFunction;
}

// ============================================================================
// Chat Request/Response Types
// ============================================================================

/** Model options for generation */
export interface OllamaModelOptions {
	/** Temperature for sampling (0.0 - 2.0) */
	temperature?: number;
	/** Top-k sampling */
	top_k?: number;
	/** Top-p (nucleus) sampling */
	top_p?: number;
	/** Number of tokens to predict */
	num_predict?: number;
	/** Stop sequences */
	stop?: string[];
	/** Random seed for reproducibility */
	seed?: number;
	/** Repeat penalty */
	repeat_penalty?: number;
	/** Presence penalty */
	presence_penalty?: number;
	/** Frequency penalty */
	frequency_penalty?: number;
	/** Mirostat mode (0, 1, or 2) */
	mirostat?: number;
	/** Mirostat target entropy */
	mirostat_tau?: number;
	/** Mirostat learning rate */
	mirostat_eta?: number;
	/** Context window size */
	num_ctx?: number;
	/** Number of GQA groups */
	num_gqa?: number;
	/** Number of GPU layers */
	num_gpu?: number;
	/** Number of threads */
	num_thread?: number;
}

/** Request body for POST /api/chat */
export interface OllamaChatRequest {
	/** Model name (e.g., "llama3.2", "mistral:7b") */
	model: string;
	/** Messages in the conversation */
	messages: OllamaMessage[];
	/** Whether to stream the response (default: true) */
	stream?: boolean;
	/** Format for structured output: 'json' or JSON schema */
	format?: 'json' | JsonSchema;
	/** Tools available to the model */
	tools?: OllamaToolDefinition[];
	/** Model-specific options */
	options?: OllamaModelOptions;
	/** How long to keep model loaded (e.g., "5m", "1h", "-1" for indefinite) */
	keep_alive?: string;
	/** Enable thinking mode for reasoning models (qwen3, deepseek-r1, etc.) */
	think?: boolean;
}

/** Performance metrics in chat response */
export interface OllamaChatMetrics {
	/** Total generation time in nanoseconds */
	total_duration?: number;
	/** Model load time in nanoseconds */
	load_duration?: number;
	/** Number of tokens in the prompt */
	prompt_eval_count?: number;
	/** Prompt evaluation time in nanoseconds */
	prompt_eval_duration?: number;
	/** Number of tokens generated */
	eval_count?: number;
	/** Generation time in nanoseconds */
	eval_duration?: number;
}

/** Full response from POST /api/chat (non-streaming) */
export interface OllamaChatResponse extends OllamaChatMetrics {
	model: string;
	created_at: string;
	message: OllamaMessage;
	done: true;
	done_reason?: 'stop' | 'length' | 'load' | 'tool_calls';
}

/** Streaming chunk from POST /api/chat */
export interface OllamaChatStreamChunk {
	model: string;
	created_at: string;
	message: OllamaMessage;
	done: boolean;
	/** Only present when done is true */
	done_reason?: 'stop' | 'length' | 'load' | 'tool_calls';
	/** Metrics only present in final chunk */
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

// ============================================================================
// Generate Types (for completeness)
// ============================================================================

/** Request body for POST /api/generate */
export interface OllamaGenerateRequest {
	model: string;
	prompt: string;
	stream?: boolean;
	format?: 'json' | JsonSchema;
	options?: OllamaModelOptions;
	system?: string;
	template?: string;
	context?: number[];
	raw?: boolean;
	keep_alive?: string;
	images?: string[];
}

/** Response from POST /api/generate (non-streaming) */
export interface OllamaGenerateResponse {
	model: string;
	created_at: string;
	response: string;
	done: true;
	done_reason?: 'stop' | 'length' | 'load';
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

/** Streaming chunk from POST /api/generate */
export interface OllamaGenerateStreamChunk {
	model: string;
	created_at: string;
	response: string;
	done: boolean;
	done_reason?: 'stop' | 'length' | 'load';
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

// ============================================================================
// Error Types
// ============================================================================

/** Ollama API error response body */
export interface OllamaErrorResponse {
	error: string;
}

/** Error codes for categorizing Ollama errors */
export type OllamaErrorCode =
	| 'CONNECTION_ERROR'
	| 'TIMEOUT_ERROR'
	| 'MODEL_NOT_FOUND'
	| 'INVALID_REQUEST'
	| 'SERVER_ERROR'
	| 'STREAM_ERROR'
	| 'PARSE_ERROR'
	| 'ABORT_ERROR'
	| 'UNKNOWN_ERROR';

// ============================================================================
// Embedding Types
// ============================================================================

/** Request body for POST /api/embed */
export interface OllamaEmbedRequest {
	model: string;
	input: string | string[];
	truncate?: boolean;
	options?: OllamaModelOptions;
	keep_alive?: string;
}

/** Response from POST /api/embed */
export interface OllamaEmbedResponse {
	model: string;
	embeddings: number[][];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
}

// ============================================================================
// Show Model Types
// ============================================================================

/** Request body for POST /api/show */
export interface OllamaShowRequest {
	model: string;
	verbose?: boolean;
}

/** Model capability types reported by Ollama */
export type OllamaCapability =
	| 'completion'      // Text generation
	| 'vision'          // Image analysis
	| 'tools'           // Function calling
	| 'embedding'       // Vector embeddings
	| 'thinking'        // Reasoning/CoT
	| 'code'            // Coding optimized
	| 'uncensored'      // No guardrails
	| 'cloud'           // Cloud offloading
	| string;           // Allow other capabilities

/** Response from POST /api/show */
export interface OllamaShowResponse {
	license?: string;
	modelfile: string;
	parameters: string;
	template: string;
	details: OllamaModelDetails;
	model_info?: Record<string, unknown>;
	modified_at: string;
	/** Model capabilities (vision, tools, code, etc.) */
	capabilities?: OllamaCapability[];
}

// ============================================================================
// Version Types
// ============================================================================

/** Response from GET /api/version */
export interface OllamaVersionResponse {
	version: string;
}

// ============================================================================
// Callback Types for Streaming
// ============================================================================

/** Callbacks for streaming chat operations */
export interface OllamaStreamCallbacks {
	/** Called for each content token */
	onToken?: (token: string) => void;
	/** Called with full chunk data */
	onChunk?: (chunk: OllamaChatStreamChunk) => void;
	/** Called when tool calls are received */
	onToolCall?: (toolCalls: OllamaToolCall[]) => void;
	/** Called when streaming is complete */
	onComplete?: (response: OllamaChatResponse) => void;
	/** Called on error */
	onError?: (error: Error) => void;
}
