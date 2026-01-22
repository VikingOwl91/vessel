/**
 * Ollama error handling tests
 *
 * Tests error classification, error types, and retry logic
 */

import { describe, it, expect, vi } from 'vitest';
import {
	OllamaError,
	OllamaConnectionError,
	OllamaTimeoutError,
	OllamaModelNotFoundError,
	OllamaInvalidRequestError,
	OllamaStreamError,
	OllamaParseError,
	OllamaAbortError,
	classifyError,
	withRetry
} from './errors';

describe('OllamaError', () => {
	it('creates error with code and message', () => {
		const error = new OllamaError('Something went wrong', 'UNKNOWN_ERROR');

		expect(error.message).toBe('Something went wrong');
		expect(error.code).toBe('UNKNOWN_ERROR');
		expect(error.name).toBe('OllamaError');
	});

	it('stores status code when provided', () => {
		const error = new OllamaError('Server error', 'SERVER_ERROR', { statusCode: 500 });

		expect(error.statusCode).toBe(500);
	});

	it('stores original error as cause', () => {
		const originalError = new Error('Original');
		const error = new OllamaError('Wrapped', 'UNKNOWN_ERROR', { cause: originalError });

		expect(error.originalError).toBe(originalError);
		expect(error.cause).toBe(originalError);
	});

	describe('isRetryable', () => {
		it('returns true for CONNECTION_ERROR', () => {
			const error = new OllamaError('Connection failed', 'CONNECTION_ERROR');
			expect(error.isRetryable).toBe(true);
		});

		it('returns true for TIMEOUT_ERROR', () => {
			const error = new OllamaError('Timed out', 'TIMEOUT_ERROR');
			expect(error.isRetryable).toBe(true);
		});

		it('returns true for SERVER_ERROR', () => {
			const error = new OllamaError('Server down', 'SERVER_ERROR');
			expect(error.isRetryable).toBe(true);
		});

		it('returns false for INVALID_REQUEST', () => {
			const error = new OllamaError('Bad request', 'INVALID_REQUEST');
			expect(error.isRetryable).toBe(false);
		});

		it('returns false for MODEL_NOT_FOUND', () => {
			const error = new OllamaError('Model missing', 'MODEL_NOT_FOUND');
			expect(error.isRetryable).toBe(false);
		});
	});
});

describe('Specialized Error Classes', () => {
	it('OllamaConnectionError has correct code', () => {
		const error = new OllamaConnectionError('Cannot connect');
		expect(error.code).toBe('CONNECTION_ERROR');
		expect(error.name).toBe('OllamaConnectionError');
	});

	it('OllamaTimeoutError stores timeout value', () => {
		const error = new OllamaTimeoutError('Request timed out', 30000);
		expect(error.code).toBe('TIMEOUT_ERROR');
		expect(error.timeoutMs).toBe(30000);
	});

	it('OllamaModelNotFoundError stores model name', () => {
		const error = new OllamaModelNotFoundError('llama3:8b');
		expect(error.code).toBe('MODEL_NOT_FOUND');
		expect(error.modelName).toBe('llama3:8b');
		expect(error.message).toContain('llama3:8b');
	});

	it('OllamaInvalidRequestError has 400 status', () => {
		const error = new OllamaInvalidRequestError('Missing required field');
		expect(error.code).toBe('INVALID_REQUEST');
		expect(error.statusCode).toBe(400);
	});

	it('OllamaStreamError preserves cause', () => {
		const cause = new Error('Stream interrupted');
		const error = new OllamaStreamError('Streaming failed', cause);
		expect(error.code).toBe('STREAM_ERROR');
		expect(error.originalError).toBe(cause);
	});

	it('OllamaParseError stores raw data', () => {
		const error = new OllamaParseError('Invalid JSON', '{"broken');
		expect(error.code).toBe('PARSE_ERROR');
		expect(error.rawData).toBe('{"broken');
	});

	it('OllamaAbortError has default message', () => {
		const error = new OllamaAbortError();
		expect(error.code).toBe('ABORT_ERROR');
		expect(error.message).toBe('Request was aborted');
	});
});

describe('classifyError', () => {
	it('returns OllamaError unchanged', () => {
		const original = new OllamaConnectionError('Already classified');
		const result = classifyError(original);

		expect(result).toBe(original);
	});

	it('classifies TypeError with fetch as connection error', () => {
		const error = new TypeError('Failed to fetch');
		const result = classifyError(error);

		expect(result).toBeInstanceOf(OllamaConnectionError);
		expect(result.code).toBe('CONNECTION_ERROR');
	});

	it('classifies TypeError with network as connection error', () => {
		const error = new TypeError('network error');
		const result = classifyError(error);

		expect(result).toBeInstanceOf(OllamaConnectionError);
	});

	it('classifies AbortError DOMException', () => {
		const error = new DOMException('Aborted', 'AbortError');
		const result = classifyError(error);

		expect(result).toBeInstanceOf(OllamaAbortError);
	});

	it('classifies ECONNREFUSED as connection error', () => {
		const error = new Error('connect ECONNREFUSED 127.0.0.1:11434');
		const result = classifyError(error);

		expect(result).toBeInstanceOf(OllamaConnectionError);
	});

	it('classifies timeout messages as timeout error', () => {
		const error = new Error('Request timed out');
		const result = classifyError(error);

		expect(result).toBeInstanceOf(OllamaTimeoutError);
	});

	it('classifies abort messages as abort error', () => {
		const error = new Error('Operation aborted by user');
		const result = classifyError(error);

		expect(result).toBeInstanceOf(OllamaAbortError);
	});

	it('adds context prefix when provided', () => {
		const error = new Error('Something failed');
		const result = classifyError(error, 'During chat');

		expect(result.message).toContain('During chat:');
	});

	it('handles non-Error values', () => {
		const result = classifyError('just a string');

		expect(result).toBeInstanceOf(OllamaError);
		expect(result.code).toBe('UNKNOWN_ERROR');
		expect(result.message).toContain('just a string');
	});

	it('handles null/undefined', () => {
		expect(classifyError(null).code).toBe('UNKNOWN_ERROR');
		expect(classifyError(undefined).code).toBe('UNKNOWN_ERROR');
	});
});

describe('withRetry', () => {
	it('returns result on first success', async () => {
		const fn = vi.fn().mockResolvedValue('success');

		const result = await withRetry(fn);

		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on retryable error', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new OllamaConnectionError('Failed'))
			.mockResolvedValueOnce('success');

		const result = await withRetry(fn, { initialDelayMs: 1 });

		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('does not retry non-retryable errors', async () => {
		const fn = vi.fn().mockRejectedValue(new OllamaInvalidRequestError('Bad request'));

		await expect(withRetry(fn)).rejects.toThrow(OllamaInvalidRequestError);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('stops after maxAttempts', async () => {
		const fn = vi.fn().mockRejectedValue(new OllamaConnectionError('Always fails'));

		await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 1 })).rejects.toThrow();
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('calls onRetry callback', async () => {
		const onRetry = vi.fn();
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new OllamaConnectionError('Failed'))
			.mockResolvedValueOnce('ok');

		await withRetry(fn, { initialDelayMs: 1, onRetry });

		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(expect.any(OllamaConnectionError), 1, 1);
	});

	it('respects abort signal', async () => {
		const controller = new AbortController();
		controller.abort();

		const fn = vi.fn().mockResolvedValue('success');

		await expect(withRetry(fn, { signal: controller.signal })).rejects.toThrow(OllamaAbortError);
		expect(fn).not.toHaveBeenCalled();
	});

	it('uses custom isRetryable function', async () => {
		// Make MODEL_NOT_FOUND retryable (not normally)
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new OllamaModelNotFoundError('test-model'))
			.mockResolvedValueOnce('found it');

		const result = await withRetry(fn, {
			initialDelayMs: 1,
			isRetryable: () => true // Retry everything
		});

		expect(result).toBe('found it');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
