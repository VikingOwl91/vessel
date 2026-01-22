/**
 * Import utility tests
 *
 * Tests import validation and file size formatting
 */

import { describe, it, expect } from 'vitest';
import { validateImport, formatFileSize } from './import';

describe('validateImport', () => {
	describe('invalid inputs', () => {
		it('rejects null', () => {
			const result = validateImport(null);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Invalid file: not a valid JSON object');
		});

		it('rejects undefined', () => {
			const result = validateImport(undefined);
			expect(result.valid).toBe(false);
		});

		it('rejects non-objects', () => {
			expect(validateImport('string').valid).toBe(false);
			expect(validateImport(123).valid).toBe(false);
			expect(validateImport([]).valid).toBe(false);
		});
	});

	describe('required fields', () => {
		it('requires id field', () => {
			const data = { title: 'Test', model: 'test', messages: [] };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing or invalid conversation ID');
		});

		it('requires title field', () => {
			const data = { id: '123', model: 'test', messages: [] };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing or invalid conversation title');
		});

		it('requires model field', () => {
			const data = { id: '123', title: 'Test', messages: [] };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing or invalid model name');
		});

		it('requires messages array', () => {
			const data = { id: '123', title: 'Test', model: 'test' };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing or invalid messages array');
		});

		it('requires messages to be an array', () => {
			const data = { id: '123', title: 'Test', model: 'test', messages: 'not array' };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing or invalid messages array');
		});
	});

	describe('message validation', () => {
		const baseData = { id: '123', title: 'Test', model: 'test' };

		it('requires role in messages', () => {
			const data = { ...baseData, messages: [{ content: 'hello' }] };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Message 1: missing or invalid role');
		});

		it('requires content in messages', () => {
			const data = { ...baseData, messages: [{ role: 'user' }] };
			const result = validateImport(data);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Message 1: missing or invalid content');
		});

		it('warns on unknown role', () => {
			const data = { ...baseData, messages: [{ role: 'unknown', content: 'test' }] };
			const result = validateImport(data);
			expect(result.valid).toBe(true);
			expect(result.warnings).toContain('Message 1: unknown role "unknown"');
		});

		it('accepts valid roles', () => {
			const roles = ['user', 'assistant', 'system', 'tool'];
			for (const role of roles) {
				const data = { ...baseData, messages: [{ role, content: 'test' }] };
				const result = validateImport(data);
				expect(result.valid).toBe(true);
				expect(result.warnings.filter(w => w.includes('unknown role'))).toHaveLength(0);
			}
		});

		it('warns on invalid images format', () => {
			const data = {
				...baseData,
				messages: [{ role: 'user', content: 'test', images: 'not-array' }]
			};
			const result = validateImport(data);
			expect(result.valid).toBe(true);
			expect(result.warnings).toContain('Message 1: invalid images format, will be ignored');
		});

		it('accepts valid images array', () => {
			const data = {
				...baseData,
				messages: [{ role: 'user', content: 'test', images: ['base64data'] }]
			};
			const result = validateImport(data);
			expect(result.valid).toBe(true);
			expect(result.warnings.filter(w => w.includes('images'))).toHaveLength(0);
		});

		it('warns on empty messages', () => {
			const data = { ...baseData, messages: [] };
			const result = validateImport(data);
			expect(result.valid).toBe(true);
			expect(result.warnings).toContain('Conversation has no messages');
		});
	});

	describe('date validation', () => {
		const baseData = { id: '123', title: 'Test', model: 'test', messages: [] };

		it('warns on invalid creation date', () => {
			const data = { ...baseData, createdAt: 'not-a-date' };
			const result = validateImport(data);
			expect(result.valid).toBe(true);
			expect(result.warnings).toContain('Invalid creation date, will use current time');
		});

		it('accepts valid ISO date', () => {
			const data = { ...baseData, createdAt: '2024-01-01T00:00:00Z' };
			const result = validateImport(data);
			expect(result.valid).toBe(true);
			expect(result.warnings.filter(w => w.includes('date'))).toHaveLength(0);
		});
	});

	describe('valid data conversion', () => {
		it('returns converted data on success', () => {
			const data = {
				id: '123',
				title: 'Test Chat',
				model: 'llama3:8b',
				createdAt: '2024-01-01T00:00:00Z',
				exportedAt: '2024-01-02T00:00:00Z',
				messages: [
					{ role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
					{ role: 'assistant', content: 'Hi!', timestamp: '2024-01-01T00:00:01Z' }
				]
			};
			const result = validateImport(data);

			expect(result.valid).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data?.id).toBe('123');
			expect(result.data?.title).toBe('Test Chat');
			expect(result.data?.model).toBe('llama3:8b');
			expect(result.data?.messages).toHaveLength(2);
		});

		it('preserves images in converted data', () => {
			const data = {
				id: '123',
				title: 'Test',
				model: 'test',
				messages: [{ role: 'user', content: 'test', images: ['img1', 'img2'] }]
			};
			const result = validateImport(data);

			expect(result.valid).toBe(true);
			expect(result.data?.messages[0].images).toEqual(['img1', 'img2']);
		});

		it('provides defaults for missing optional fields', () => {
			const data = {
				id: '123',
				title: 'Test',
				model: 'test',
				messages: [{ role: 'user', content: 'test' }]
			};
			const result = validateImport(data);

			expect(result.valid).toBe(true);
			expect(result.data?.createdAt).toBeDefined();
			expect(result.data?.exportedAt).toBeDefined();
			expect(result.data?.messages[0].timestamp).toBeDefined();
		});
	});

	describe('error accumulation', () => {
		it('reports multiple errors', () => {
			const data = { messages: 'not-array' };
			const result = validateImport(data);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(1);
			expect(result.errors).toContain('Missing or invalid conversation ID');
			expect(result.errors).toContain('Missing or invalid conversation title');
			expect(result.errors).toContain('Missing or invalid model name');
		});
	});
});

describe('formatFileSize', () => {
	it('formats zero bytes', () => {
		expect(formatFileSize(0)).toBe('0 B');
	});

	it('formats bytes', () => {
		expect(formatFileSize(100)).toBe('100 B');
		expect(formatFileSize(1023)).toBe('1023 B');
	});

	it('formats kilobytes', () => {
		expect(formatFileSize(1024)).toBe('1 KB');
		expect(formatFileSize(1536)).toBe('1.5 KB');
		expect(formatFileSize(10240)).toBe('10 KB');
	});

	it('formats megabytes', () => {
		expect(formatFileSize(1024 * 1024)).toBe('1 MB');
		expect(formatFileSize(1024 * 1024 * 5.5)).toBe('5.5 MB');
	});

	it('formats gigabytes', () => {
		expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
		expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
	});
});
