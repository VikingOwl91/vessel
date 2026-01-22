/**
 * Attachment type guards tests
 *
 * Tests file type detection utilities
 */

import { describe, it, expect } from 'vitest';
import {
	isImageMimeType,
	isTextMimeType,
	isPdfMimeType,
	isTextExtension,
	IMAGE_MIME_TYPES,
	TEXT_MIME_TYPES,
	TEXT_FILE_EXTENSIONS
} from './attachment';

describe('isImageMimeType', () => {
	it('returns true for supported image types', () => {
		expect(isImageMimeType('image/jpeg')).toBe(true);
		expect(isImageMimeType('image/png')).toBe(true);
		expect(isImageMimeType('image/gif')).toBe(true);
		expect(isImageMimeType('image/webp')).toBe(true);
		expect(isImageMimeType('image/bmp')).toBe(true);
	});

	it('returns false for non-image types', () => {
		expect(isImageMimeType('text/plain')).toBe(false);
		expect(isImageMimeType('application/pdf')).toBe(false);
		expect(isImageMimeType('image/svg+xml')).toBe(false); // Not in supported list
		expect(isImageMimeType('')).toBe(false);
	});

	it('returns false for partial matches', () => {
		expect(isImageMimeType('image/')).toBe(false);
		expect(isImageMimeType('image/jpeg/extra')).toBe(false);
	});
});

describe('isTextMimeType', () => {
	it('returns true for supported text types', () => {
		expect(isTextMimeType('text/plain')).toBe(true);
		expect(isTextMimeType('text/markdown')).toBe(true);
		expect(isTextMimeType('text/html')).toBe(true);
		expect(isTextMimeType('text/css')).toBe(true);
		expect(isTextMimeType('text/javascript')).toBe(true);
		expect(isTextMimeType('application/json')).toBe(true);
		expect(isTextMimeType('application/javascript')).toBe(true);
	});

	it('returns false for non-text types', () => {
		expect(isTextMimeType('image/png')).toBe(false);
		expect(isTextMimeType('application/pdf')).toBe(false);
		expect(isTextMimeType('application/octet-stream')).toBe(false);
		expect(isTextMimeType('')).toBe(false);
	});
});

describe('isPdfMimeType', () => {
	it('returns true for PDF mime type', () => {
		expect(isPdfMimeType('application/pdf')).toBe(true);
	});

	it('returns false for non-PDF types', () => {
		expect(isPdfMimeType('text/plain')).toBe(false);
		expect(isPdfMimeType('image/png')).toBe(false);
		expect(isPdfMimeType('application/json')).toBe(false);
		expect(isPdfMimeType('')).toBe(false);
	});
});

describe('isTextExtension', () => {
	describe('code files', () => {
		it('recognizes JavaScript/TypeScript files', () => {
			expect(isTextExtension('app.js')).toBe(true);
			expect(isTextExtension('component.jsx')).toBe(true);
			expect(isTextExtension('index.ts')).toBe(true);
			expect(isTextExtension('App.tsx')).toBe(true);
		});

		it('recognizes Python files', () => {
			expect(isTextExtension('script.py')).toBe(true);
		});

		it('recognizes Go files', () => {
			expect(isTextExtension('main.go')).toBe(true);
		});

		it('recognizes Rust files', () => {
			expect(isTextExtension('lib.rs')).toBe(true);
		});

		it('recognizes C/C++ files', () => {
			expect(isTextExtension('main.c')).toBe(true);
			expect(isTextExtension('util.cpp')).toBe(true);
			expect(isTextExtension('header.h')).toBe(true);
			expect(isTextExtension('class.hpp')).toBe(true);
		});
	});

	describe('config files', () => {
		it('recognizes JSON/YAML/TOML', () => {
			expect(isTextExtension('config.json')).toBe(true);
			expect(isTextExtension('docker-compose.yaml')).toBe(true);
			expect(isTextExtension('config.yml')).toBe(true);
			expect(isTextExtension('Cargo.toml')).toBe(true);
		});

		it('recognizes dotfiles', () => {
			expect(isTextExtension('.gitignore')).toBe(true);
			expect(isTextExtension('.dockerignore')).toBe(true);
			expect(isTextExtension('.env')).toBe(true);
		});
	});

	describe('web files', () => {
		it('recognizes HTML/CSS', () => {
			expect(isTextExtension('index.html')).toBe(true);
			expect(isTextExtension('page.htm')).toBe(true);
			expect(isTextExtension('styles.css')).toBe(true);
			expect(isTextExtension('app.scss')).toBe(true);
		});

		it('recognizes framework files', () => {
			expect(isTextExtension('App.svelte')).toBe(true);
			expect(isTextExtension('Component.vue')).toBe(true);
			expect(isTextExtension('Page.astro')).toBe(true);
		});
	});

	describe('text files', () => {
		it('recognizes markdown', () => {
			expect(isTextExtension('README.md')).toBe(true);
			expect(isTextExtension('docs.markdown')).toBe(true);
		});

		it('recognizes plain text', () => {
			expect(isTextExtension('notes.txt')).toBe(true);
		});
	});

	it('is case insensitive', () => {
		expect(isTextExtension('FILE.TXT')).toBe(true);
		expect(isTextExtension('Script.PY')).toBe(true);
		expect(isTextExtension('README.MD')).toBe(true);
	});

	it('returns false for unknown extensions', () => {
		expect(isTextExtension('image.png')).toBe(false);
		expect(isTextExtension('document.pdf')).toBe(false);
		expect(isTextExtension('archive.zip')).toBe(false);
		expect(isTextExtension('binary.exe')).toBe(false);
		expect(isTextExtension('noextension')).toBe(false);
	});
});

describe('Constants are defined', () => {
	it('IMAGE_MIME_TYPES has expected values', () => {
		expect(IMAGE_MIME_TYPES).toContain('image/jpeg');
		expect(IMAGE_MIME_TYPES).toContain('image/png');
		expect(IMAGE_MIME_TYPES.length).toBeGreaterThan(0);
	});

	it('TEXT_MIME_TYPES has expected values', () => {
		expect(TEXT_MIME_TYPES).toContain('text/plain');
		expect(TEXT_MIME_TYPES).toContain('application/json');
		expect(TEXT_MIME_TYPES.length).toBeGreaterThan(0);
	});

	it('TEXT_FILE_EXTENSIONS has expected values', () => {
		expect(TEXT_FILE_EXTENSIONS).toContain('.ts');
		expect(TEXT_FILE_EXTENSIONS).toContain('.py');
		expect(TEXT_FILE_EXTENSIONS).toContain('.md');
		expect(TEXT_FILE_EXTENSIONS.length).toBeGreaterThan(20);
	});
});
