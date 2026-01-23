/**
 * Tests for Unified LLM Client
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Types matching the backend response
interface ChatChunk {
	model: string;
	message?: {
		role: string;
		content: string;
	};
	done: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	eval_count?: number;
}

interface Model {
	name: string;
	size: number;
	digest: string;
	modified_at: string;
}

describe('UnifiedLLMClient', () => {
	let UnifiedLLMClient: typeof import('./client.js').UnifiedLLMClient;
	let client: InstanceType<typeof UnifiedLLMClient>;

	beforeEach(async () => {
		vi.resetModules();

		// Mock fetch
		global.fetch = vi.fn();

		const module = await import('./client.js');
		UnifiedLLMClient = module.UnifiedLLMClient;
		client = new UnifiedLLMClient();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('listModels', () => {
		it('fetches models from unified API', async () => {
			const mockModels: Model[] = [
				{
					name: 'llama3.2:8b',
					size: 4500000000,
					digest: 'abc123',
					modified_at: '2024-01-15T10:00:00Z'
				}
			];

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ models: mockModels, backend: 'ollama' })
			});

			const result = await client.listModels();

			expect(result.models).toEqual(mockModels);
			expect(result.backend).toBe('ollama');
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/v1/ai/models'),
				expect.objectContaining({ method: 'GET' })
			);
		});

		it('throws on API error', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: 'Service Unavailable',
				json: async () => ({ error: 'no active backend' })
			});

			await expect(client.listModels()).rejects.toThrow('no active backend');
		});
	});

	describe('chat', () => {
		it('sends chat request to unified API', async () => {
			const mockResponse: ChatChunk = {
				model: 'llama3.2:8b',
				message: { role: 'assistant', content: 'Hello!' },
				done: true,
				total_duration: 1000000000,
				eval_count: 10
			};

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse
			});

			const result = await client.chat({
				model: 'llama3.2:8b',
				messages: [{ role: 'user', content: 'Hi' }]
			});

			expect(result.message?.content).toBe('Hello!');
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/v1/ai/chat'),
				expect.objectContaining({
					method: 'POST',
					body: expect.stringContaining('"model":"llama3.2:8b"')
				})
			);
		});
	});

	describe('streamChat', () => {
		it('streams chat responses as NDJSON', async () => {
			const chunks: ChatChunk[] = [
				{ model: 'llama3.2:8b', message: { role: 'assistant', content: 'Hello' }, done: false },
				{ model: 'llama3.2:8b', message: { role: 'assistant', content: ' there' }, done: false },
				{ model: 'llama3.2:8b', message: { role: 'assistant', content: '!' }, done: true }
			];

			// Create a mock readable stream
			const mockBody = new ReadableStream({
				start(controller) {
					for (const chunk of chunks) {
						controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + '\n'));
					}
					controller.close();
				}
			});

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				body: mockBody
			});

			const receivedChunks: ChatChunk[] = [];
			for await (const chunk of client.streamChat({
				model: 'llama3.2:8b',
				messages: [{ role: 'user', content: 'Hi' }]
			})) {
				receivedChunks.push(chunk);
			}

			expect(receivedChunks).toHaveLength(3);
			expect(receivedChunks[0].message?.content).toBe('Hello');
			expect(receivedChunks[2].done).toBe(true);
		});

		it('handles stream errors', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: async () => ({ error: 'Internal Server Error' })
			});

			const generator = client.streamChat({
				model: 'llama3.2:8b',
				messages: [{ role: 'user', content: 'Hi' }]
			});

			await expect(generator.next()).rejects.toThrow('Internal Server Error');
		});
	});

	describe('healthCheck', () => {
		it('returns true when backend is healthy', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: 'healthy' })
			});

			const result = await client.healthCheck('ollama');

			expect(result).toBe(true);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/v1/ai/backends/ollama/health'),
				expect.any(Object)
			);
		});

		it('returns false when backend is unhealthy', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 503,
				json: async () => ({ status: 'unhealthy', error: 'Connection refused' })
			});

			const result = await client.healthCheck('ollama');

			expect(result).toBe(false);
		});
	});

	describe('configuration', () => {
		it('uses custom base URL', async () => {
			const customClient = new UnifiedLLMClient({ baseUrl: 'http://custom:9090' });

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ models: [], backend: 'ollama' })
			});

			await customClient.listModels();

			expect(global.fetch).toHaveBeenCalledWith(
				'http://custom:9090/api/v1/ai/models',
				expect.any(Object)
			);
		});

		it('respects abort signal', async () => {
			const controller = new AbortController();
			controller.abort();

			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new DOMException('The user aborted a request.', 'AbortError')
			);

			await expect(client.listModels(controller.signal)).rejects.toThrow('aborted');
		});
	});
});
