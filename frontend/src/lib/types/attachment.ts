/**
 * File attachment types for multi-modal chat
 * Supports images (for vision models), text files, and PDFs (content extracted as text)
 */

// ============================================================================
// Core Types
// ============================================================================

/** Type of file attachment */
export type AttachmentType = 'image' | 'text' | 'pdf';

/** File attachment with extracted content */
export interface FileAttachment {
	/** Unique identifier */
	id: string;
	/** Type of attachment */
	type: AttachmentType;
	/** Original filename */
	filename: string;
	/** MIME type (e.g., 'image/png', 'text/plain', 'application/pdf') */
	mimeType: string;
	/** File size in bytes */
	size: number;
	/** Extracted text content (for text/pdf types) */
	textContent?: string;
	/** Base64-encoded data (for images, WITHOUT data: prefix for Ollama) */
	base64Data?: string;
	/** Preview thumbnail for images (data URI with prefix for display) */
	previewUrl?: string;
}

// ============================================================================
// File Type Detection
// ============================================================================

/** Common text file extensions */
export const TEXT_FILE_EXTENSIONS = [
	'.txt',
	'.md',
	'.markdown',
	'.json',
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.py',
	'.go',
	'.rs',
	'.java',
	'.c',
	'.cpp',
	'.h',
	'.hpp',
	'.rb',
	'.php',
	'.sh',
	'.bash',
	'.zsh',
	'.sql',
	'.css',
	'.scss',
	'.sass',
	'.less',
	'.html',
	'.htm',
	'.xml',
	'.yaml',
	'.yml',
	'.toml',
	'.ini',
	'.cfg',
	'.conf',
	'.env',
	'.gitignore',
	'.dockerignore',
	'.svelte',
	'.vue',
	'.astro'
] as const;

/** Image MIME types we support */
export const IMAGE_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/bmp'
] as const;

/** Text MIME types we support */
export const TEXT_MIME_TYPES = [
	'text/plain',
	'text/markdown',
	'text/html',
	'text/css',
	'text/javascript',
	'text/xml',
	'application/json',
	'application/javascript',
	'application/xml',
	'application/x-yaml'
] as const;

/** PDF MIME type */
export const PDF_MIME_TYPE = 'application/pdf';

// ============================================================================
// Size Limits
// ============================================================================

/** Maximum image size (2MB after compression) */
export const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

/** Maximum text file size (1MB) */
export const MAX_TEXT_SIZE = 1 * 1024 * 1024;

/** Maximum PDF size (10MB) */
export const MAX_PDF_SIZE = 10 * 1024 * 1024;

/** Maximum image dimensions (LLaVA limit) */
export const MAX_IMAGE_DIMENSION = 1344;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if MIME type is an image */
export function isImageMimeType(mimeType: string): boolean {
	return IMAGE_MIME_TYPES.includes(mimeType as typeof IMAGE_MIME_TYPES[number]);
}

/** Check if MIME type is text */
export function isTextMimeType(mimeType: string): boolean {
	return TEXT_MIME_TYPES.includes(mimeType as typeof TEXT_MIME_TYPES[number]);
}

/** Check if MIME type is PDF */
export function isPdfMimeType(mimeType: string): boolean {
	return mimeType === PDF_MIME_TYPE;
}

/** Check if file extension is a known text type */
export function isTextExtension(filename: string): boolean {
	const lower = filename.toLowerCase();
	return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ============================================================================
// Utility Types
// ============================================================================

/** Result of processing a file */
export interface ProcessFileResult {
	success: true;
	attachment: FileAttachment;
}

/** Error during file processing */
export interface ProcessFileError {
	success: false;
	error: string;
}

/** Combined result type */
export type ProcessFileOutcome = ProcessFileResult | ProcessFileError;
