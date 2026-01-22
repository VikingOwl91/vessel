/**
 * Export utility tests
 *
 * Tests export formatting, filename generation, and share encoding
 */

import { describe, it, expect } from 'vitest';
import {
	generateFilename,
	generatePreview,
	encodeShareableData,
	decodeShareableData,
	type ShareableData
} from './export';

describe('generateFilename', () => {
	it('creates filename with title and timestamp', () => {
		const filename = generateFilename('My Chat', 'md');
		expect(filename).toMatch(/^My_Chat_\d{4}-\d{2}-\d{2}\.md$/);
	});

	it('replaces spaces with underscores', () => {
		const filename = generateFilename('Hello World Test', 'json');
		expect(filename).toContain('Hello_World_Test');
	});

	it('removes Windows-unsafe characters', () => {
		const filename = generateFilename('File<with>special:chars/and|more?*"quotes', 'md');
		expect(filename).not.toMatch(/[<>:"/\\|?*]/);
	});

	it('collapses multiple underscores', () => {
		const filename = generateFilename('Multiple   spaces   here', 'md');
		expect(filename).not.toContain('__');
	});

	it('trims leading and trailing underscores from title', () => {
		const filename = generateFilename('  spaced  ', 'md');
		// Title part should not have leading underscore, but underscore before date is expected
		expect(filename).toMatch(/^spaced_\d{4}/);
	});

	it('limits title length to 50 characters', () => {
		const longTitle = 'a'.repeat(100);
		const filename = generateFilename(longTitle, 'md');
		// Should have: max 50 chars + underscore + date (10 chars) + .md (3 chars)
		expect(filename.length).toBeLessThanOrEqual(50 + 1 + 10 + 3);
	});

	it('handles empty title', () => {
		const filename = generateFilename('', 'md');
		// Empty title produces underscore prefix before timestamp
		expect(filename).toMatch(/_\d{4}-\d{2}-\d{2}\.md$/);
		expect(filename).toContain('.md');
	});

	it('supports different extensions', () => {
		expect(generateFilename('test', 'json')).toMatch(/\.json$/);
		expect(generateFilename('test', 'txt')).toMatch(/\.txt$/);
	});
});

describe('generatePreview', () => {
	it('returns full content if under maxLines', () => {
		const content = 'line1\nline2\nline3';
		expect(generatePreview(content, 10)).toBe(content);
	});

	it('returns full content if exactly at maxLines', () => {
		const content = 'line1\nline2\nline3';
		expect(generatePreview(content, 3)).toBe(content);
	});

	it('truncates content over maxLines', () => {
		const content = 'line1\nline2\nline3\nline4\nline5';
		const preview = generatePreview(content, 3);
		expect(preview).toBe('line1\nline2\nline3\n...');
	});

	it('uses default maxLines of 10', () => {
		const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`);
		const content = lines.join('\n');
		const preview = generatePreview(content);
		expect(preview.split('\n').length).toBe(11); // 10 lines + "..."
		expect(preview).toContain('...');
	});

	it('handles single line content', () => {
		const content = 'single line';
		expect(generatePreview(content, 5)).toBe(content);
	});

	it('handles empty content', () => {
		expect(generatePreview('', 5)).toBe('');
	});
});

describe('encodeShareableData / decodeShareableData', () => {
	const testData: ShareableData = {
		version: 1,
		title: 'Test Chat',
		model: 'llama3:8b',
		messages: [
			{ role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
			{ role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01Z' }
		]
	};

	it('encodes data to base64 string', () => {
		const encoded = encodeShareableData(testData);
		expect(typeof encoded).toBe('string');
		expect(encoded.length).toBeGreaterThan(0);
	});

	it('decodes back to original data', () => {
		const encoded = encodeShareableData(testData);
		const decoded = decodeShareableData(encoded);
		expect(decoded).toEqual(testData);
	});

	it('handles UTF-8 characters', () => {
		const dataWithUnicode: ShareableData = {
			version: 1,
			title: '你好世界 🌍',
			model: 'test',
			messages: [
				{ role: 'user', content: 'Привет мир', timestamp: '2024-01-01T00:00:00Z' }
			]
		};

		const encoded = encodeShareableData(dataWithUnicode);
		const decoded = decodeShareableData(encoded);
		expect(decoded).toEqual(dataWithUnicode);
	});

	it('handles special characters in content', () => {
		const dataWithSpecialChars: ShareableData = {
			version: 1,
			title: 'Test',
			model: 'test',
			messages: [
				{
					role: 'user',
					content: 'Code: `const x = 1;` and "quotes" and \'apostrophes\'',
					timestamp: '2024-01-01T00:00:00Z'
				}
			]
		};

		const encoded = encodeShareableData(dataWithSpecialChars);
		const decoded = decodeShareableData(encoded);
		expect(decoded).toEqual(dataWithSpecialChars);
	});

	it('handles empty messages array', () => {
		const dataEmpty: ShareableData = {
			version: 1,
			title: 'Empty',
			model: 'test',
			messages: []
		};

		const encoded = encodeShareableData(dataEmpty);
		const decoded = decodeShareableData(encoded);
		expect(decoded).toEqual(dataEmpty);
	});
});

describe('decodeShareableData validation', () => {
	it('returns null for invalid base64', () => {
		expect(decodeShareableData('not-valid-base64!@#$')).toBeNull();
	});

	it('returns null for invalid JSON', () => {
		const invalidJson = btoa(encodeURIComponent('not json'));
		expect(decodeShareableData(invalidJson)).toBeNull();
	});

	it('returns null for missing version', () => {
		const noVersion = { title: 'test', model: 'test', messages: [] };
		const encoded = btoa(encodeURIComponent(JSON.stringify(noVersion)));
		expect(decodeShareableData(encoded)).toBeNull();
	});

	it('returns null for non-numeric version', () => {
		const badVersion = { version: 'one', title: 'test', model: 'test', messages: [] };
		const encoded = btoa(encodeURIComponent(JSON.stringify(badVersion)));
		expect(decodeShareableData(encoded)).toBeNull();
	});

	it('returns null for missing messages array', () => {
		const noMessages = { version: 1, title: 'test', model: 'test' };
		const encoded = btoa(encodeURIComponent(JSON.stringify(noMessages)));
		expect(decodeShareableData(encoded)).toBeNull();
	});

	it('returns null for non-array messages', () => {
		const badMessages = { version: 1, title: 'test', model: 'test', messages: 'not an array' };
		const encoded = btoa(encodeURIComponent(JSON.stringify(badMessages)));
		expect(decodeShareableData(encoded)).toBeNull();
	});

	it('returns valid data for minimal valid structure', () => {
		const minimal = { version: 1, messages: [] };
		const encoded = btoa(encodeURIComponent(JSON.stringify(minimal)));
		const decoded = decodeShareableData(encoded);
		expect(decoded).not.toBeNull();
		expect(decoded?.version).toBe(1);
		expect(decoded?.messages).toEqual([]);
	});
});
