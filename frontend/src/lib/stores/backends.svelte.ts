/**
 * Backend state management using Svelte 5 runes.
 * Handles multiple LLM backend registration, selection, and status tracking.
 */

import type { BackendClient } from '$lib/backends/client.js';
import type {
	BackendType,
	BackendStatus,
	BackendConfig,
	Capability
} from '$lib/backends/types.js';
import { createOllamaBackend } from '$lib/backends/ollama/adapter.js';
import { createLlamaCppBackend } from '$lib/backends/llamacpp/adapter.js';
import { createVLMBackend } from '$lib/backends/vlm/adapter.js';

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
	PRIMARY_BACKEND: 'vessel.primaryBackend',
	BACKEND_CONFIGS: 'vessel.backendConfigs'
} as const;

// ============================================================================
// Types
// ============================================================================

/** Registered backend with its client and metadata */
interface RegisteredBackend {
	client: BackendClient;
	config: BackendConfig;
	status: BackendStatus;
	lastStatusCheck: number;
}

/** Options for registering a backend */
export interface RegisterBackendOptions {
	id: string;
	type: BackendType;
	name: string;
	baseUrl?: string;
	enabled?: boolean;
	priority?: number;
}

// ============================================================================
// Backend State
// ============================================================================

/**
 * Backend state class with reactive properties.
 * Manages multiple LLM backends and their lifecycle.
 */
export class BackendsState {
	// Core state
	private backends = $state<Map<string, RegisteredBackend>>(new Map());
	primaryId = $state<string | null>(null);
	isInitializing = $state(false);
	error = $state<string | null>(null);

	// Status polling
	private statusPollingInterval: ReturnType<typeof setInterval> | null = null;
	private readonly STATUS_POLL_MS = 30000; // 30 seconds

	// Derived: Primary backend client
	primary = $derived.by(() => {
		if (!this.primaryId) return null;
		return this.backends.get(this.primaryId)?.client ?? null;
	});

	// Derived: Primary backend status
	primaryStatus = $derived.by(() => {
		if (!this.primaryId) return null;
		return this.backends.get(this.primaryId)?.status ?? null;
	});

	// Derived: All registered backends as array
	all = $derived.by(() => {
		return Array.from(this.backends.values()).map((b) => ({
			id: b.config.id,
			type: b.config.type,
			name: b.config.name,
			enabled: b.config.enabled,
			capabilities: b.config.capabilities,
			priority: b.config.priority,
			status: b.status
		}));
	});

	// Derived: Enabled backends sorted by priority
	enabled = $derived.by(() => {
		return this.all
			.filter((b) => b.enabled)
			.sort((a, b) => a.priority - b.priority);
	});

	// Derived: Available backends (enabled and reachable)
	available = $derived.by(() => {
		return this.enabled.filter((b) => b.status.available);
	});

	// Derived: Backend configs for persistence
	configs = $derived.by(() => {
		return Array.from(this.backends.values()).map((b) => b.config);
	});

	// ==========================================================================
	// Initialization
	// ==========================================================================

	/**
	 * Initialize backends from stored configuration.
	 * Creates default Ollama backend if no configuration exists.
	 */
	async initialize(): Promise<void> {
		if (this.isInitializing) return;

		this.isInitializing = true;
		this.error = null;

		try {
			// Load persisted configs
			const storedConfigs = this.loadStoredConfigs();

			if (storedConfigs.length === 0) {
				// Create default Ollama backend
				await this.registerBackend({
					id: 'ollama-default',
					type: 'ollama',
					name: 'Ollama',
					enabled: true,
					priority: 1
				});
			} else {
				// Restore backends from config
				for (const config of storedConfigs) {
					await this.registerBackendFromConfig(config);
				}
			}

			// Load persisted primary selection
			const storedPrimary = this.loadStoredPrimary();
			if (storedPrimary && this.backends.has(storedPrimary)) {
				this.primaryId = storedPrimary;
			} else {
				// Auto-select first enabled backend
				this.autoSelectPrimary();
			}

			// Initial status check
			await this.refreshAllStatus();

			// Start status polling
			this.startStatusPolling();
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to initialize backends';
			console.error('Backend initialization failed:', err);
		} finally {
			this.isInitializing = false;
		}
	}

	/**
	 * Cleanup resources when the store is no longer needed.
	 */
	dispose(): void {
		this.stopStatusPolling();

		// Dispose all backend clients
		for (const backend of this.backends.values()) {
			backend.client.dispose();
		}

		this.backends = new Map();
		this.primaryId = null;
	}

	// ==========================================================================
	// Backend Registration
	// ==========================================================================

	/**
	 * Register a new backend.
	 */
	async registerBackend(options: RegisterBackendOptions): Promise<BackendClient> {
		const { id, type, name, baseUrl, enabled = true, priority = 10 } = options;

		// Create client based on type
		let client: BackendClient;
		switch (type) {
			case 'ollama':
				client = createOllamaBackend({ id, name, baseUrl });
				break;
			case 'llama-cpp-server':
				client = createLlamaCppBackend({ id, name, baseUrl });
				break;
			case 'vlm':
				client = createVLMBackend({ id, name, baseUrl });
				break;
			// Future backends will be added here
			case 'llama-cpp-native':
			case 'huggingface':
				throw new Error(`Backend type '${type}' is not yet implemented`);
			default:
				throw new Error(`Unknown backend type: ${type}`);
		}

		const config: BackendConfig = {
			id,
			type,
			name,
			baseUrl,
			enabled,
			capabilities: client.capabilities,
			priority
		};

		const status: BackendStatus = {
			available: false
		};

		const registered: RegisteredBackend = {
			client,
			config,
			status,
			lastStatusCheck: 0
		};

		// Update backends map reactively
		const newBackends = new Map(this.backends);
		newBackends.set(id, registered);
		this.backends = newBackends;

		// Persist configs
		this.persistConfigs();

		// Check status
		await this.refreshStatus(id);

		return client;
	}

	/**
	 * Register a backend from a saved config.
	 */
	private async registerBackendFromConfig(config: BackendConfig): Promise<void> {
		await this.registerBackend({
			id: config.id,
			type: config.type,
			name: config.name,
			baseUrl: config.baseUrl,
			enabled: config.enabled,
			priority: config.priority
		});
	}

	/**
	 * Unregister a backend.
	 */
	unregisterBackend(id: string): void {
		const backend = this.backends.get(id);
		if (!backend) return;

		// Dispose client
		backend.client.dispose();

		// Remove from map
		const newBackends = new Map(this.backends);
		newBackends.delete(id);
		this.backends = newBackends;

		// Update primary if needed
		if (this.primaryId === id) {
			this.autoSelectPrimary();
		}

		// Persist
		this.persistConfigs();
	}

	// ==========================================================================
	// Backend Selection
	// ==========================================================================

	/**
	 * Set the primary backend by ID.
	 */
	setPrimary(id: string): void {
		if (!this.backends.has(id)) {
			console.warn(`Cannot set primary: backend '${id}' not found`);
			return;
		}

		const backend = this.backends.get(id)!;
		if (!backend.config.enabled) {
			console.warn(`Cannot set primary: backend '${id}' is disabled`);
			return;
		}

		this.primaryId = id;
		this.persistPrimary();
	}

	/**
	 * Auto-select the best available primary backend.
	 */
	private autoSelectPrimary(): void {
		// Find first enabled backend by priority
		const sorted = Array.from(this.backends.values())
			.filter((b) => b.config.enabled)
			.sort((a, b) => a.config.priority - b.config.priority);

		if (sorted.length > 0) {
			this.primaryId = sorted[0].config.id;
			this.persistPrimary();
		} else {
			this.primaryId = null;
		}
	}

	// ==========================================================================
	// Backend Configuration
	// ==========================================================================

	/**
	 * Update backend configuration.
	 */
	updateConfig(id: string, updates: Partial<Omit<BackendConfig, 'id' | 'type'>>): void {
		const backend = this.backends.get(id);
		if (!backend) return;

		const newConfig = { ...backend.config, ...updates };
		const newBackends = new Map(this.backends);
		newBackends.set(id, { ...backend, config: newConfig });
		this.backends = newBackends;

		// Handle enabled change
		if (updates.enabled === false && this.primaryId === id) {
			this.autoSelectPrimary();
		}

		this.persistConfigs();
	}

	/**
	 * Enable or disable a backend.
	 */
	setEnabled(id: string, enabled: boolean): void {
		this.updateConfig(id, { enabled });
	}

	/**
	 * Update backend priority.
	 */
	setPriority(id: string, priority: number): void {
		this.updateConfig(id, { priority });
	}

	// ==========================================================================
	// Status Management
	// ==========================================================================

	/**
	 * Refresh status for a specific backend.
	 */
	async refreshStatus(id: string): Promise<BackendStatus> {
		const backend = this.backends.get(id);
		if (!backend) {
			throw new Error(`Backend '${id}' not found`);
		}

		try {
			const status = await backend.client.status();

			// Update status reactively
			const newBackends = new Map(this.backends);
			newBackends.set(id, {
				...backend,
				status,
				lastStatusCheck: Date.now()
			});
			this.backends = newBackends;

			return status;
		} catch (err) {
			const status: BackendStatus = { available: false };

			const newBackends = new Map(this.backends);
			newBackends.set(id, {
				...backend,
				status,
				lastStatusCheck: Date.now()
			});
			this.backends = newBackends;

			return status;
		}
	}

	/**
	 * Refresh status for all backends.
	 */
	async refreshAllStatus(): Promise<void> {
		const promises = Array.from(this.backends.keys()).map((id) =>
			this.refreshStatus(id).catch(() => {
				// Ignore individual failures
			})
		);
		await Promise.all(promises);
	}

	/**
	 * Start periodic status polling.
	 */
	private startStatusPolling(): void {
		this.stopStatusPolling();
		this.statusPollingInterval = setInterval(() => {
			this.refreshAllStatus();
		}, this.STATUS_POLL_MS);
	}

	/**
	 * Stop status polling.
	 */
	private stopStatusPolling(): void {
		if (this.statusPollingInterval) {
			clearInterval(this.statusPollingInterval);
			this.statusPollingInterval = null;
		}
	}

	// ==========================================================================
	// Backend Access
	// ==========================================================================

	/**
	 * Get a backend client by ID.
	 */
	getClient(id: string): BackendClient | undefined {
		return this.backends.get(id)?.client;
	}

	/**
	 * Get backend status by ID.
	 */
	getStatus(id: string): BackendStatus | undefined {
		return this.backends.get(id)?.status;
	}

	/**
	 * Get backend config by ID.
	 */
	getConfig(id: string): BackendConfig | undefined {
		return this.backends.get(id)?.config;
	}

	/**
	 * Check if a backend has a specific capability.
	 */
	hasCapability(id: string, capability: Capability): boolean {
		const backend = this.backends.get(id);
		return backend?.client.hasCapability(capability) ?? false;
	}

	/**
	 * Find backends that support a specific capability.
	 */
	findByCapability(capability: Capability): BackendConfig[] {
		return this.configs.filter((c) => c.capabilities.includes(capability));
	}

	// ==========================================================================
	// Persistence
	// ==========================================================================

	/**
	 * Load stored backend configs from localStorage.
	 */
	private loadStoredConfigs(): BackendConfig[] {
		if (typeof localStorage === 'undefined') return [];

		try {
			const stored = localStorage.getItem(STORAGE_KEYS.BACKEND_CONFIGS);
			if (!stored) return [];

			const configs = JSON.parse(stored) as BackendConfig[];
			return Array.isArray(configs) ? configs : [];
		} catch {
			return [];
		}
	}

	/**
	 * Persist backend configs to localStorage.
	 */
	private persistConfigs(): void {
		if (typeof localStorage === 'undefined') return;

		try {
			localStorage.setItem(STORAGE_KEYS.BACKEND_CONFIGS, JSON.stringify(this.configs));
		} catch (err) {
			console.warn('Failed to persist backend configs:', err);
		}
	}

	/**
	 * Load stored primary backend ID.
	 */
	private loadStoredPrimary(): string | null {
		if (typeof localStorage === 'undefined') return null;

		try {
			return localStorage.getItem(STORAGE_KEYS.PRIMARY_BACKEND);
		} catch {
			return null;
		}
	}

	/**
	 * Persist primary backend ID.
	 */
	private persistPrimary(): void {
		if (typeof localStorage === 'undefined') return;

		try {
			if (this.primaryId) {
				localStorage.setItem(STORAGE_KEYS.PRIMARY_BACKEND, this.primaryId);
			} else {
				localStorage.removeItem(STORAGE_KEYS.PRIMARY_BACKEND);
			}
		} catch (err) {
			console.warn('Failed to persist primary backend:', err);
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Singleton backends state instance */
export const backendsState = new BackendsState();
