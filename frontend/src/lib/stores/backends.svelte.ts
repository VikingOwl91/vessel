/**
 * Backends state management using Svelte 5 runes
 * Manages multiple LLM backend configurations (Ollama, llama.cpp, LM Studio)
 */

/** Backend type identifiers */
export type BackendType = 'ollama' | 'llamacpp' | 'lmstudio';

/** Backend connection status */
export type BackendStatus = 'connected' | 'disconnected' | 'unknown';

/** Backend capabilities */
export interface BackendCapabilities {
	canListModels: boolean;
	canPullModels: boolean;
	canDeleteModels: boolean;
	canCreateModels: boolean;
	canStreamChat: boolean;
	canEmbed: boolean;
}

/** Backend information */
export interface BackendInfo {
	type: BackendType;
	baseUrl: string;
	status: BackendStatus;
	capabilities: BackendCapabilities;
	version?: string;
	error?: string;
}

/** Discovery result for a backend endpoint */
export interface DiscoveryResult {
	type: BackendType;
	baseUrl: string;
	available: boolean;
	version?: string;
	error?: string;
}

/** Health check result */
export interface HealthResult {
	healthy: boolean;
	error?: string;
}

/** API response wrapper */
interface ApiResponse<T> {
	data?: T;
	error?: string;
}

/** Get base URL for API calls */
function getApiBaseUrl(): string {
	if (typeof window !== 'undefined') {
		const envUrl = (import.meta.env as Record<string, string>)?.PUBLIC_BACKEND_URL;
		if (envUrl) return envUrl;
	}
	return '';
}

/** Make an API request */
async function apiRequest<T>(
	method: string,
	path: string,
	body?: unknown
): Promise<ApiResponse<T>> {
	const baseUrl = getApiBaseUrl();

	try {
		const response = await fetch(`${baseUrl}${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json'
			},
			body: body ? JSON.stringify(body) : undefined
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			return { error: errorData.error || `HTTP ${response.status}: ${response.statusText}` };
		}

		const data = await response.json();
		return { data };
	} catch (err) {
		if (err instanceof Error) {
			return { error: err.message };
		}
		return { error: 'Unknown error occurred' };
	}
}

/** Backends state class with reactive properties */
export class BackendsState {
	/** All configured backends */
	backends = $state<BackendInfo[]>([]);

	/** Currently active backend type */
	activeType = $state<BackendType | null>(null);

	/** Loading state */
	isLoading = $state(false);

	/** Discovering state */
	isDiscovering = $state(false);

	/** Error state */
	error = $state<string | null>(null);

	/** Promise that resolves when initial load is complete */
	private _readyPromise: Promise<void> | null = null;
	private _readyResolve: (() => void) | null = null;

	/** Derived: the currently active backend info */
	get activeBackend(): BackendInfo | null {
		if (!this.activeType) return null;
		return this.backends.find((b) => b.type === this.activeType) ?? null;
	}

	/** Derived: whether the active backend can pull models (Ollama only) */
	get canPullModels(): boolean {
		return this.activeBackend?.capabilities.canPullModels ?? false;
	}

	/** Derived: whether the active backend can delete models (Ollama only) */
	get canDeleteModels(): boolean {
		return this.activeBackend?.capabilities.canDeleteModels ?? false;
	}

	/** Derived: whether the active backend can create custom models (Ollama only) */
	get canCreateModels(): boolean {
		return this.activeBackend?.capabilities.canCreateModels ?? false;
	}

	/** Derived: connected backends */
	get connectedBackends(): BackendInfo[] {
		return this.backends.filter((b) => b.status === 'connected');
	}

	constructor() {
		// Create ready promise
		this._readyPromise = new Promise((resolve) => {
			this._readyResolve = resolve;
		});

		// Load backends on initialization (client-side only)
		if (typeof window !== 'undefined') {
			this.load();
		} else {
			// SSR: resolve immediately
			this._readyResolve?.();
		}
	}

	/** Wait for initial load to complete */
	async ready(): Promise<void> {
		return this._readyPromise ?? Promise.resolve();
	}

	/**
	 * Load backends from the API
	 */
	async load(): Promise<void> {
		this.isLoading = true;
		this.error = null;

		try {
			const result = await apiRequest<{ backends: BackendInfo[]; active: string }>(
				'GET',
				'/api/v1/ai/backends'
			);

			if (result.data) {
				this.backends = result.data.backends || [];
				this.activeType = (result.data.active as BackendType) || null;
			} else if (result.error) {
				this.error = result.error;
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to load backends';
		} finally {
			this.isLoading = false;
			this._readyResolve?.();
		}
	}

	/**
	 * Discover available backends by probing default endpoints
	 */
	async discover(endpoints?: Array<{ type: BackendType; baseUrl: string }>): Promise<DiscoveryResult[]> {
		this.isDiscovering = true;
		this.error = null;

		try {
			const result = await apiRequest<{ results: DiscoveryResult[] }>(
				'POST',
				'/api/v1/ai/backends/discover',
				endpoints ? { endpoints } : {}
			);

			if (result.data?.results) {
				return result.data.results;
			} else if (result.error) {
				this.error = result.error;
			}
			return [];
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to discover backends';
			return [];
		} finally {
			this.isDiscovering = false;
		}
	}

	/**
	 * Set the active backend
	 */
	async setActive(type: BackendType): Promise<boolean> {
		this.error = null;

		try {
			const result = await apiRequest<{ active: string }>('POST', '/api/v1/ai/backends/active', {
				type
			});

			if (result.data) {
				this.activeType = result.data.active as BackendType;
				return true;
			} else if (result.error) {
				this.error = result.error;
			}
			return false;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to set active backend';
			return false;
		}
	}

	/**
	 * Check the health of a specific backend
	 */
	async checkHealth(type: BackendType): Promise<HealthResult> {
		try {
			const result = await apiRequest<{ status: string; error?: string }>(
				'GET',
				`/api/v1/ai/backends/${type}/health`
			);

			if (result.data) {
				return {
					healthy: result.data.status === 'healthy',
					error: result.data.error
				};
			} else {
				return {
					healthy: false,
					error: result.error
				};
			}
		} catch (err) {
			return {
				healthy: false,
				error: err instanceof Error ? err.message : 'Health check failed'
			};
		}
	}

	/**
	 * Update local backend configuration (URL)
	 * Note: This updates local state only; backend registration happens via discovery
	 */
	updateConfig(type: BackendType, config: { baseUrl?: string }): void {
		this.backends = this.backends.map((b) => {
			if (b.type === type) {
				return {
					...b,
					...config
				};
			}
			return b;
		});
	}

	/**
	 * Get a backend by type
	 */
	get(type: BackendType): BackendInfo | undefined {
		return this.backends.find((b) => b.type === type);
	}

	/**
	 * Clear any error state
	 */
	clearError(): void {
		this.error = null;
	}
}

/** Singleton backends state instance */
export const backendsState = new BackendsState();
