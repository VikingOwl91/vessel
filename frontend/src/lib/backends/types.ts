/**
 * Backend-agnostic types for multi-LLM support.
 * These normalized types abstract away backend-specific details,
 * enabling the frontend to work with any supported backend.
 */

// ============================================================================
// Backend Identification
// ============================================================================

/** Supported LLM backend types */
export type BackendType = 'ollama' | 'llama-cpp-server' | 'llama-cpp-native' | 'huggingface' | 'vlm';

/** Backend capability flags */
export type Capability =
	| 'chat'       // Chat completions
	| 'generate'   // Text generation
	| 'embed'      // Embeddings
	| 'vision'     // Image inputs
	| 'tools'      // Function calling
	| 'thinking'   // Reasoning/CoT
	| 'pull'       // Model downloading
	| 'delete'     // Model deletion
	| 'create'     // Custom model creation
	| 'streaming'; // Streaming responses

// ============================================================================
// Message Types
// ============================================================================

/** Message role in a conversation */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Tool call function details */
export interface ToolCallFunction {
	name: string;
	arguments: string; // JSON string
}

/** Tool call requested by the model */
export interface ToolCall {
	id: string;
	type: 'function';
	function: ToolCallFunction;
}

/** A message in a chat conversation */
export interface Message {
	role: MessageRole;
	content: string;
	images?: string[];       // Base64-encoded images
	toolCalls?: ToolCall[];  // Tool invocations from assistant
	toolCallId?: string;     // ID when responding to a tool call
	thinking?: string;       // Reasoning content from thinking models
}

// ============================================================================
// Tool Definition Types
// ============================================================================

/** JSON Schema property for tool parameters */
export interface ToolParameterProperty {
	type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
	description?: string;
	enum?: string[];
	items?: ToolParameterProperty;
	properties?: Record<string, ToolParameterProperty>;
	required?: string[];
}

/** Tool parameter schema (JSON Schema subset) */
export interface ToolParameters {
	type: 'object';
	properties: Record<string, ToolParameterProperty>;
	required?: string[];
}

/** Tool function specification */
export interface ToolFunction {
	name: string;
	description: string;
	parameters?: ToolParameters;
}

/** Tool definition for the model */
export interface Tool {
	type: 'function';
	function: ToolFunction;
}

// ============================================================================
// Chat Request/Response Types
// ============================================================================

/** Model generation options (normalized across backends) */
export interface GenerationOptions {
	temperature?: number;      // 0.0 - 2.0
	topP?: number;             // Nucleus sampling
	topK?: number;             // Top-k sampling
	maxTokens?: number;        // Response length limit
	stop?: string[];           // Stop sequences
	seed?: number;             // Random seed
	repeatPenalty?: number;
	presencePenalty?: number;
	frequencyPenalty?: number;
	contextSize?: number;      // Context window override
}

/** Request for chat completion */
export interface ChatRequest {
	model: string;
	messages: Message[];
	stream?: boolean;
	tools?: Tool[];
	options?: GenerationOptions;
	format?: 'json' | Record<string, unknown>; // Structured output
	think?: boolean;           // Enable thinking mode
}

/** Performance metrics for a generation */
export interface GenerationMetrics {
	promptTokensPerSec: number;
	decodeTokensPerSec: number;
	avgTokensPerSec?: number;
	contextUsed: number;
	contextMax: number;
	kvCachePercent?: number;
	batchSize?: number;
}

/** Response from chat completion */
export interface ChatResponse {
	model: string;
	message: Message;
	done: boolean;
	doneReason?: 'stop' | 'length' | 'tool_calls';
	promptTokens?: number;
	responseTokens?: number;
	totalDurationMs?: number;
	loadDurationMs?: number;
	promptEvalDurationMs?: number;
	evalDurationMs?: number;
	metrics?: GenerationMetrics;
}

/** Streaming chunk during chat */
export interface ChatStreamChunk {
	model: string;
	message: Message;
	done: boolean;
	doneReason?: 'stop' | 'length' | 'tool_calls';
	// Metrics only present in final chunk
	promptTokens?: number;
	responseTokens?: number;
	totalDurationMs?: number;
}

// ============================================================================
// Model Types
// ============================================================================

/** Basic model information */
export interface ModelInfo {
	name: string;
	modifiedAt: Date;
	size: number;           // Bytes
	digest: string;
	family?: string;
	parameterSize?: string; // e.g., "7B", "13B"
	quantLevel?: string;    // e.g., "Q4_K_M"
	contextLength?: number;
	capabilities?: Capability[];
}

/** Extended model details */
export interface ModelDetails extends ModelInfo {
	license?: string;
	modelfile?: string;
	parameters?: string;
	template?: string;
	systemPrompt?: string;
}

// ============================================================================
// Model Operations Types
// ============================================================================

/** Progress during model pull/download */
export interface PullProgress {
	status: string;
	digest?: string;
	total?: number;
	completed?: number;
}

/** Request for embeddings */
export interface EmbedRequest {
	model: string;
	input: string[];
	options?: GenerationOptions;
}

/** Response with embeddings */
export interface EmbedResponse {
	model: string;
	embeddings: number[][];
	promptTokens?: number;
}

// ============================================================================
// Backend Status Types
// ============================================================================

/** Current state of a backend */
export interface BackendStatus {
	available: boolean;
	loadedModel?: string;
	version?: string;
	gpuMemoryUsed?: number;
	gpuMemoryTotal?: number;
	queueDepth?: number;
	currentMetrics?: GenerationMetrics;
}

/** Backend configuration summary */
export interface BackendConfig {
	id: string;
	type: BackendType;
	name: string;
	baseUrl?: string;
	enabled: boolean;
	capabilities: Capability[];
	priority: number;
}

// ============================================================================
// Error Types
// ============================================================================

/** Error categories for consistent handling */
export type ErrorCategory =
	| 'load_failure'   // Model failed to load
	| 'vram_oom'       // Out of GPU memory
	| 'backend_init'   // Backend initialization failed
	| 'runtime_crash'  // Unexpected crash during inference
	| 'network'        // Network/connection error
	| 'auth'           // Authentication error
	| 'rate_limit'     // Rate limited
	| 'validation'     // Invalid request
	| 'cancelled'      // User cancelled
	| 'unknown';       // Unknown error

/** Structured backend error */
export interface BackendError {
	code: string;
	message: string;
	category: ErrorCategory;
	suggestion?: string;
	retryable: boolean;
	context?: {
		engineVersion?: string;
		modelId?: string;
		flagsUsed?: string[];
		requestId?: string;
	};
}

// ============================================================================
// Streaming Callbacks
// ============================================================================

/** Callbacks for streaming chat operations */
export interface StreamCallbacks {
	onToken?: (token: string) => void;
	onChunk?: (chunk: ChatStreamChunk) => void;
	onToolCall?: (toolCalls: ToolCall[]) => void;
	onThinking?: (thinking: string) => void;
	onComplete?: (response: ChatResponse) => void;
	onError?: (error: BackendError) => void;
}

/** Result from streaming chat */
export interface StreamResult {
	content: string;
	thinking?: string;
	toolCalls?: ToolCall[];
	response?: ChatResponse;
	aborted: boolean;
}

// ============================================================================
// Chat Template Types
// ============================================================================

/** Chat template for formatting messages */
export interface ChatTemplate {
	name: string;
	template: string;
	stopSequences: string[];
	bosToken?: string;
	eosToken?: string;
	systemFormat?: string;
	addGenerationPrompt: boolean;
}

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a value is a BackendError */
export function isBackendError(value: unknown): value is BackendError {
	return (
		typeof value === 'object' &&
		value !== null &&
		'code' in value &&
		'message' in value &&
		'category' in value &&
		'retryable' in value
	);
}

/** Check if an error category is retryable by default */
export function isRetryableCategory(category: ErrorCategory): boolean {
	return category === 'network' || category === 'rate_limit';
}
