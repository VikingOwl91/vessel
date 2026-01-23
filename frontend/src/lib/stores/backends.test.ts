/**
 * Tests for BackendsState store
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Types for the backends API
interface BackendInfo {
	type: 'ollama' | 'llamacpp' | 'lmstudio';
	baseUrl: string;
	status: 'connected' | 'disconnected' | 'unknown';
	capabilities: BackendCapabilities;
	version?: string;
	error?: string;
}

interface BackendCapabilities {
	canListModels: boolean;
	canPullModels: boolean;
	canDeleteModels: boolean;
	canCreateModels: boolean;
	canStreamChat: boolean;
	canEmbed: boolean;
}

interface DiscoveryResult {
	type: 'ollama' | 'llamacpp' | 'lmstudio';
	baseUrl: string;
	available: boolean;
	version?: string;
	error?: string;
}

describe('BackendsState', () => {
	let BackendsState: typeof import('./backends.svelte.js').BackendsState;
	let backendsState: InstanceType<typeof BackendsState>;

	beforeEach(async () => {
		// Reset modules for fresh state
		vi.resetModules();

		// Mock fetch globally with default empty response for initial load
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ backends: [], active: '' })
		});

		// Import fresh module
		const module = await import('./backends.svelte.js');
		BackendsState = module.BackendsState;
		backendsState = new BackendsState();

		// Wait for initial load to complete
		await backendsState.ready();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initialization', () => {
		it('starts with empty backends array', () => {
			expect(backendsState.backends).toEqual([]);
		});

		it('starts with no active backend', () => {
			expect(backendsState.activeType).toBeNull();
		});

		it('starts with not loading', () => {
			expect(backendsState.isLoading).toBe(false);
		});

		it('starts with no error', () => {
			expect(backendsState.error).toBeNull();
		});
	});

	describe('load', () => {
		it('loads backends from API', async () => {
			const mockBackends: BackendInfo[] = [
				{
					type: 'ollama',
					baseUrl: 'http://localhost:11434',
					status: 'connected',
					capabilities: {
						canListModels: true,
						canPullModels: true,
						canDeleteModels: true,
						canCreateModels: true,
						canStreamChat: true,
						canEmbed: true
					},
					version: '0.3.0'
				}
			];

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ backends: mockBackends, active: 'ollama' })
			});

			await backendsState.load();

			expect(backendsState.backends).toEqual(mockBackends);
			expect(backendsState.activeType).toBe('ollama');
			expect(backendsState.isLoading).toBe(false);
		});

		it('handles load error', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				json: async () => ({ error: 'Server error' })
			});

			await backendsState.load();

			expect(backendsState.error).not.toBeNull();
			expect(backendsState.isLoading).toBe(false);
		});

		it('handles network error', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			await backendsState.load();

			expect(backendsState.error).toBe('Network error');
			expect(backendsState.isLoading).toBe(false);
		});
	});

	describe('discover', () => {
		it('discovers available backends', async () => {
			const mockResults: DiscoveryResult[] = [
				{
					type: 'ollama',
					baseUrl: 'http://localhost:11434',
					available: true,
					version: '0.3.0'
				},
				{
					type: 'llamacpp',
					baseUrl: 'http://localhost:8081',
					available: true
				},
				{
					type: 'lmstudio',
					baseUrl: 'http://localhost:1234',
					available: false,
					error: 'Connection refused'
				}
			];

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ results: mockResults })
			});

			const results = await backendsState.discover();

			expect(results).toEqual(mockResults);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/v1/ai/backends/discover'),
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('returns empty array on error', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const results = await backendsState.discover();

			expect(results).toEqual([]);
			expect(backendsState.error).toBe('Network error');
		});
	});

	describe('setActive', () => {
		it('sets active backend', async () => {
			// First load some backends
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					backends: [
						{ type: 'ollama', baseUrl: 'http://localhost:11434', status: 'connected' }
					],
					active: ''
				})
			});
			await backendsState.load();

			// Then set active
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ active: 'ollama' })
			});

			const success = await backendsState.setActive('ollama');

			expect(success).toBe(true);
			expect(backendsState.activeType).toBe('ollama');
		});

		it('handles setActive error', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
				json: async () => ({ error: 'Backend not registered' })
			});

			const success = await backendsState.setActive('llamacpp');

			expect(success).toBe(false);
			expect(backendsState.error).not.toBeNull();
		});
	});

	describe('checkHealth', () => {
		it('checks backend health', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: 'healthy' })
			});

			const result = await backendsState.checkHealth('ollama');

			expect(result.healthy).toBe(true);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/v1/ai/backends/ollama/health'),
				expect.any(Object)
			);
		});

		it('returns unhealthy on error response', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: 'Service Unavailable',
				json: async () => ({ status: 'unhealthy', error: 'Connection refused' })
			});

			const result = await backendsState.checkHealth('ollama');

			expect(result.healthy).toBe(false);
			expect(result.error).toBe('Connection refused');
		});
	});

	describe('derived state', () => {
		it('activeBackend returns the active backend info', async () => {
			const mockBackends: BackendInfo[] = [
				{
					type: 'ollama',
					baseUrl: 'http://localhost:11434',
					status: 'connected',
					capabilities: {
						canListModels: true,
						canPullModels: true,
						canDeleteModels: true,
						canCreateModels: true,
						canStreamChat: true,
						canEmbed: true
					}
				},
				{
					type: 'llamacpp',
					baseUrl: 'http://localhost:8081',
					status: 'connected',
					capabilities: {
						canListModels: true,
						canPullModels: false,
						canDeleteModels: false,
						canCreateModels: false,
						canStreamChat: true,
						canEmbed: true
					}
				}
			];

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ backends: mockBackends, active: 'llamacpp' })
			});

			await backendsState.load();

			const active = backendsState.activeBackend;
			expect(active?.type).toBe('llamacpp');
			expect(active?.baseUrl).toBe('http://localhost:8081');
		});

		it('canPullModels is true only for Ollama', async () => {
			const mockBackends: BackendInfo[] = [
				{
					type: 'ollama',
					baseUrl: 'http://localhost:11434',
					status: 'connected',
					capabilities: {
						canListModels: true,
						canPullModels: true,
						canDeleteModels: true,
						canCreateModels: true,
						canStreamChat: true,
						canEmbed: true
					}
				}
			];

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ backends: mockBackends, active: 'ollama' })
			});

			await backendsState.load();

			expect(backendsState.canPullModels).toBe(true);
		});

		it('canPullModels is false for llama.cpp', async () => {
			const mockBackends: BackendInfo[] = [
				{
					type: 'llamacpp',
					baseUrl: 'http://localhost:8081',
					status: 'connected',
					capabilities: {
						canListModels: true,
						canPullModels: false,
						canDeleteModels: false,
						canCreateModels: false,
						canStreamChat: true,
						canEmbed: true
					}
				}
			];

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ backends: mockBackends, active: 'llamacpp' })
			});

			await backendsState.load();

			expect(backendsState.canPullModels).toBe(false);
		});
	});

	describe('updateConfig', () => {
		it('updates backend URL', async () => {
			// Load initial backends
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					backends: [
						{
							type: 'ollama',
							baseUrl: 'http://localhost:11434',
							status: 'connected',
							capabilities: {
								canListModels: true,
								canPullModels: true,
								canDeleteModels: true,
								canCreateModels: true,
								canStreamChat: true,
								canEmbed: true
							}
						}
					],
					active: 'ollama'
				})
			});
			await backendsState.load();

			// Update config
			backendsState.updateConfig('ollama', { baseUrl: 'http://192.168.1.100:11434' });

			const backend = backendsState.backends.find((b) => b.type === 'ollama');
			expect(backend?.baseUrl).toBe('http://192.168.1.100:11434');
		});
	});
});
