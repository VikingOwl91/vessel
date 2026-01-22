/**
 * File processor utility tests
 *
 * Tests file type detection, formatting, and utility functions
 */

import { describe, it, expect } from 'vitest';
import {
	detectFileType,
	formatFileSize,
	getFileIcon,
	formatAttachmentsForMessage
} from './file-processor';
import type { FileAttachment } from '$lib/types/attachment';

// Helper to create mock File objects
function createMockFile(name: string, type: string, size: number = 1000): File {
	return {
		name,
		type,
		size,
		lastModified: Date.now(),
		webkitRelativePath: '',
		slice: () => new Blob(),
		stream: () => new ReadableStream(),
		text: () => Promise.resolve(''),
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
	} as File;
}

describe('detectFileType', () => {
	describe('image types', () => {
		it('detects JPEG images', () => {
			expect(detectFileType(createMockFile('photo.jpg', 'image/jpeg'))).toBe('image');
		});

		it('detects PNG images', () => {
			expect(detectFileType(createMockFile('icon.png', 'image/png'))).toBe('image');
		});

		it('detects GIF images', () => {
			expect(detectFileType(createMockFile('anim.gif', 'image/gif'))).toBe('image');
		});

		it('detects WebP images', () => {
			expect(detectFileType(createMockFile('photo.webp', 'image/webp'))).toBe('image');
		});
	});

	describe('PDF type', () => {
		it('detects PDF files', () => {
			expect(detectFileType(createMockFile('doc.pdf', 'application/pdf'))).toBe('pdf');
		});
	});

	describe('text types by mime', () => {
		it('detects plain text', () => {
			expect(detectFileType(createMockFile('readme.txt', 'text/plain'))).toBe('text');
		});

		it('detects markdown', () => {
			expect(detectFileType(createMockFile('doc.md', 'text/markdown'))).toBe('text');
		});

		it('detects HTML', () => {
			expect(detectFileType(createMockFile('page.html', 'text/html'))).toBe('text');
		});

		it('detects JSON', () => {
			expect(detectFileType(createMockFile('data.json', 'application/json'))).toBe('text');
		});
	});

	describe('text types by extension fallback', () => {
		it('detects TypeScript by extension', () => {
			expect(detectFileType(createMockFile('app.ts', ''))).toBe('text');
		});

		it('detects Python by extension', () => {
			expect(detectFileType(createMockFile('script.py', ''))).toBe('text');
		});

		it('detects Go by extension', () => {
			expect(detectFileType(createMockFile('main.go', ''))).toBe('text');
		});

		it('detects YAML by extension', () => {
			expect(detectFileType(createMockFile('config.yaml', ''))).toBe('text');
		});
	});

	describe('unsupported types', () => {
		it('returns null for binary files', () => {
			expect(detectFileType(createMockFile('app.exe', 'application/octet-stream'))).toBeNull();
		});

		it('returns null for archives', () => {
			expect(detectFileType(createMockFile('archive.zip', 'application/zip'))).toBeNull();
		});

		it('returns null for unknown extensions', () => {
			expect(detectFileType(createMockFile('data.xyz', ''))).toBeNull();
		});
	});

	it('is case insensitive for mime types', () => {
		expect(detectFileType(createMockFile('img.jpg', 'IMAGE/JPEG'))).toBe('image');
	});
});

describe('formatFileSize', () => {
	it('formats bytes', () => {
		expect(formatFileSize(0)).toBe('0 B');
		expect(formatFileSize(100)).toBe('100 B');
		expect(formatFileSize(1023)).toBe('1023 B');
	});

	it('formats kilobytes', () => {
		expect(formatFileSize(1024)).toBe('1.0 KB');
		expect(formatFileSize(1536)).toBe('1.5 KB');
		expect(formatFileSize(10240)).toBe('10.0 KB');
		expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB');
	});

	it('formats megabytes', () => {
		expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
		expect(formatFileSize(1024 * 1024 * 5)).toBe('5.0 MB');
		expect(formatFileSize(1024 * 1024 * 10.5)).toBe('10.5 MB');
	});
});

describe('getFileIcon', () => {
	it('returns image icon for images', () => {
		expect(getFileIcon('image')).toBe('🖼️');
	});

	it('returns document icon for PDFs', () => {
		expect(getFileIcon('pdf')).toBe('📄');
	});

	it('returns note icon for text', () => {
		expect(getFileIcon('text')).toBe('📝');
	});

	it('returns paperclip for unknown types', () => {
		expect(getFileIcon('unknown' as 'text')).toBe('📎');
	});
});

describe('formatAttachmentsForMessage', () => {
	it('returns empty string for empty array', () => {
		expect(formatAttachmentsForMessage([])).toBe('');
	});

	it('filters out attachments without text content', () => {
		const attachments: FileAttachment[] = [
			{
				id: '1',
				type: 'image',
				filename: 'photo.jpg',
				mimeType: 'image/jpeg',
				size: 1000
			}
		];
		expect(formatAttachmentsForMessage(attachments)).toBe('');
	});

	it('formats text attachment with XML tags', () => {
		const attachments: FileAttachment[] = [
			{
				id: '1',
				type: 'text',
				filename: 'readme.txt',
				mimeType: 'text/plain',
				size: 100,
				textContent: 'Hello, World!'
			}
		];
		const result = formatAttachmentsForMessage(attachments);
		expect(result).toContain('<file name="readme.txt"');
		expect(result).toContain('size="100 B"');
		expect(result).toContain('Hello, World!');
		expect(result).toContain('</file>');
	});

	it('includes truncated attribute when content is truncated', () => {
		const attachments: FileAttachment[] = [
			{
				id: '1',
				type: 'text',
				filename: 'large.txt',
				mimeType: 'text/plain',
				size: 1000000,
				textContent: 'Content...',
				truncated: true,
				originalLength: 1000000
			}
		];
		const result = formatAttachmentsForMessage(attachments);
		expect(result).toContain('truncated="true"');
	});

	it('escapes XML special characters in filename', () => {
		const attachments: FileAttachment[] = [
			{
				id: '1',
				type: 'text',
				filename: 'file<with>&"special\'chars.txt',
				mimeType: 'text/plain',
				size: 100,
				textContent: 'content'
			}
		];
		const result = formatAttachmentsForMessage(attachments);
		expect(result).toContain('&lt;');
		expect(result).toContain('&gt;');
		expect(result).toContain('&amp;');
		expect(result).toContain('&quot;');
		expect(result).toContain('&apos;');
	});

	it('formats multiple attachments separated by newlines', () => {
		const attachments: FileAttachment[] = [
			{
				id: '1',
				type: 'text',
				filename: 'file1.txt',
				mimeType: 'text/plain',
				size: 100,
				textContent: 'Content 1'
			},
			{
				id: '2',
				type: 'text',
				filename: 'file2.txt',
				mimeType: 'text/plain',
				size: 200,
				textContent: 'Content 2'
			}
		];
		const result = formatAttachmentsForMessage(attachments);
		expect(result).toContain('file1.txt');
		expect(result).toContain('file2.txt');
		expect(result.split('</file>').length - 1).toBe(2);
	});
});
