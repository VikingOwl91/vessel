/**
 * OllamaClient tests
 *
 * Tests the Ollama API client with mocked fetch
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaClient } from './client';

// Helper to create mock fetch response
function mockResponse(data: unknown, status = 200, ok = true): Response {
	return {
		ok,
		status,
		statusText: ok ? 'OK' : 'Error',
		json: async () => data,
		text: async () => JSON.stringify(data),
		headers: new Headers({ 'Content-Type': 'application/json' }),
		clone: () => mockResponse(data, status, ok)
	} as Response;
}

// Helper to create streaming response
function mockStreamResponse(chunks: unknown[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
			}
			controller.close();
		}
	});

	return {
		ok: true,
		status: 200,
		body: stream,
		headers: new Headers()
	} as Response;
}

describe('OllamaClient', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mockFetch: any;
	let client: OllamaClient;

	beforeEach(() => {
		mockFetch = vi.fn();
		client = new OllamaClient({
			baseUrl: 'http://localhost:11434',
			fetchFn: mockFetch,
			enableRetry: false
		});
	});

	describe('constructor', () => {
		it('uses default config when not provided', () => {
			const defaultClient = new OllamaClient({ fetchFn: mockFetch });
			expect(defaultClient.baseUrl).toBe('');
		});

		it('uses custom base URL', () => {
			expect(client.baseUrl).toBe('http://localhost:11434');
		});
	});

	describe('listModels', () => {
		it('fetches models list', async () => {
			const models = {
				models: [
					{ name: 'llama3:8b', size: 4000000000 },
					{ name: 'mistral:7b', size: 3500000000 }
				]
			};
			mockFetch.mockResolvedValueOnce(mockResponse(models));

			const result = await client.listModels();

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/tags',
				expect.objectContaining({ method: 'GET' })
			);
			expect(result.models).toHaveLength(2);
			expect(result.models[0].name).toBe('llama3:8b');
		});
	});

	describe('listRunningModels', () => {
		it('fetches running models', async () => {
			const running = {
				models: [{ name: 'llama3:8b', size: 4000000000 }]
			};
			mockFetch.mockResolvedValueOnce(mockResponse(running));

			const result = await client.listRunningModels();

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/ps',
				expect.objectContaining({ method: 'GET' })
			);
			expect(result.models).toHaveLength(1);
		});
	});

	describe('showModel', () => {
		it('fetches model details with string arg', async () => {
			const details = {
				modelfile: 'FROM llama3',
				parameters: 'temperature 0.8'
			};
			mockFetch.mockResolvedValueOnce(mockResponse(details));

			const result = await client.showModel('llama3:8b');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/show',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ model: 'llama3:8b' })
				})
			);
			expect(result.modelfile).toBe('FROM llama3');
		});

		it('fetches model details with request object', async () => {
			const details = { modelfile: 'FROM llama3' };
			mockFetch.mockResolvedValueOnce(mockResponse(details));

			await client.showModel({ model: 'llama3:8b', verbose: true });

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/show',
				expect.objectContaining({
					body: JSON.stringify({ model: 'llama3:8b', verbose: true })
				})
			);
		});
	});

	describe('deleteModel', () => {
		it('sends delete request', async () => {
			mockFetch.mockResolvedValueOnce(mockResponse({}));

			await client.deleteModel('old-model');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/delete',
				expect.objectContaining({
					method: 'DELETE',
					body: JSON.stringify({ name: 'old-model' })
				})
			);
		});
	});

	describe('pullModel', () => {
		it('streams pull progress', async () => {
			const chunks = [
				{ status: 'pulling manifest' },
				{ status: 'downloading', completed: 50, total: 100 },
				{ status: 'success' }
			];
			mockFetch.mockResolvedValueOnce(mockStreamResponse(chunks));

			const progress: unknown[] = [];
			await client.pullModel('llama3:8b', (p) => progress.push(p));

			expect(progress).toHaveLength(3);
			expect(progress[0]).toEqual({ status: 'pulling manifest' });
			expect(progress[2]).toEqual({ status: 'success' });
		});
	});

	describe('createModel', () => {
		it('streams create progress', async () => {
			const chunks = [
				{ status: 'creating new layer sha256:abc...' },
				{ status: 'writing manifest' },
				{ status: 'success' }
			];
			mockFetch.mockResolvedValueOnce(mockStreamResponse(chunks));

			const progress: unknown[] = [];
			await client.createModel(
				{ model: 'my-custom', from: 'llama3:8b', system: 'You are helpful' },
				(p) => progress.push(p)
			);

			expect(progress).toHaveLength(3);
			expect(progress[2]).toEqual({ status: 'success' });
		});
	});

	describe('chat', () => {
		it('sends chat request', async () => {
			const response = {
				message: { role: 'assistant', content: 'Hello!' },
				done: true
			};
			mockFetch.mockResolvedValueOnce(mockResponse(response));

			const result = await client.chat({
				model: 'llama3:8b',
				messages: [{ role: 'user', content: 'Hi' }]
			});

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/chat',
				expect.objectContaining({
					method: 'POST'
				})
			);

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.model).toBe('llama3:8b');
			expect(body.stream).toBe(false);
			expect(result.message.content).toBe('Hello!');
		});

		it('includes tools in request', async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse({ message: { role: 'assistant', content: 'ok' }, done: true })
			);

			await client.chat({
				model: 'llama3:8b',
				messages: [{ role: 'user', content: 'test' }],
				tools: [
					{
						type: 'function',
						function: {
							name: 'get_time',
							description: 'Get current time',
							parameters: { type: 'object', properties: {} }
						}
					}
				]
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.tools).toHaveLength(1);
			expect(body.tools[0].function.name).toBe('get_time');
		});

		it('includes options in request', async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse({ message: { role: 'assistant', content: 'ok' }, done: true })
			);

			await client.chat({
				model: 'llama3:8b',
				messages: [{ role: 'user', content: 'test' }],
				options: { temperature: 0.5, num_ctx: 4096 }
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.options.temperature).toBe(0.5);
			expect(body.options.num_ctx).toBe(4096);
		});

		it('includes think option for reasoning models', async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse({ message: { role: 'assistant', content: 'ok' }, done: true })
			);

			await client.chat({
				model: 'qwen3:8b',
				messages: [{ role: 'user', content: 'test' }],
				think: true
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.think).toBe(true);
		});
	});

	describe('generate', () => {
		it('sends generate request', async () => {
			const response = { response: 'Generated text', done: true };
			mockFetch.mockResolvedValueOnce(mockResponse(response));

			const result = await client.generate({
				model: 'llama3:8b',
				prompt: 'Complete this: Hello'
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.stream).toBe(false);
			expect(result.response).toBe('Generated text');
		});
	});

	describe('embed', () => {
		it('generates embeddings', async () => {
			const response = { embeddings: [[0.1, 0.2, 0.3]] };
			mockFetch.mockResolvedValueOnce(mockResponse(response));

			const result = await client.embed({
				model: 'nomic-embed-text',
				input: 'test text'
			});

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:11434/api/embed',
				expect.objectContaining({ method: 'POST' })
			);
			expect(result.embeddings[0]).toHaveLength(3);
		});
	});

	describe('healthCheck', () => {
		it('returns true when server responds', async () => {
			mockFetch.mockResolvedValueOnce(mockResponse({ version: '0.3.0' }));

			const healthy = await client.healthCheck();

			expect(healthy).toBe(true);
		});

		it('returns false when server fails', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

			const healthy = await client.healthCheck();

			expect(healthy).toBe(false);
		});
	});

	describe('getVersion', () => {
		it('returns version info', async () => {
			mockFetch.mockResolvedValueOnce(mockResponse({ version: '0.3.0' }));

			const result = await client.getVersion();

			expect(result.version).toBe('0.3.0');
		});
	});

	describe('testConnection', () => {
		it('returns success status when connected', async () => {
			mockFetch.mockResolvedValueOnce(mockResponse({ version: '0.3.0' }));

			const status = await client.testConnection();

			expect(status.connected).toBe(true);
			expect(status.version).toBe('0.3.0');
			expect(status.latencyMs).toBeGreaterThanOrEqual(0);
			expect(status.baseUrl).toBe('http://localhost:11434');
		});

		it('returns error status when disconnected', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

			const status = await client.testConnection();

			expect(status.connected).toBe(false);
			expect(status.error).toBeDefined();
			expect(status.latencyMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe('withConfig', () => {
		it('creates new client with updated config', () => {
			const newClient = client.withConfig({ baseUrl: 'http://other:11434' });

			expect(newClient.baseUrl).toBe('http://other:11434');
			expect(client.baseUrl).toBe('http://localhost:11434'); // Original unchanged
		});
	});

	describe('error handling', () => {
		it('throws on non-ok response', async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse({ error: 'Model not found' }, 404, false)
			);

			await expect(client.listModels()).rejects.toThrow();
		});
	});
});
