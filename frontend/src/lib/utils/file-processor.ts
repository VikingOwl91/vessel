/**
 * File processor utility
 * Handles reading, processing, and extracting content from files
 * Supports images, text files, and PDFs
 */

import type {
	AttachmentType,
	FileAttachment,
	ProcessFileOutcome
} from '$lib/types/attachment.js';
import {
	isImageMimeType,
	isTextMimeType,
	isPdfMimeType,
	isTextExtension,
	MAX_IMAGE_SIZE,
	MAX_TEXT_SIZE,
	MAX_PDF_SIZE,
	MAX_IMAGE_DIMENSION
} from '$lib/types/attachment.js';

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Detect the attachment type for a file
 * @returns The attachment type or null if unsupported
 */
export function detectFileType(file: File): AttachmentType | null {
	const mimeType = file.type.toLowerCase();

	if (isImageMimeType(mimeType)) {
		return 'image';
	}

	if (isPdfMimeType(mimeType)) {
		return 'pdf';
	}

	if (isTextMimeType(mimeType)) {
		return 'text';
	}

	// Check by extension as fallback
	if (isTextExtension(file.name)) {
		return 'text';
	}

	return null;
}

// ============================================================================
// Text File Processing
// ============================================================================

/**
 * Read a text file and return its content
 */
export async function readTextFile(file: File): Promise<string> {
	if (file.size > MAX_TEXT_SIZE) {
		throw new Error(`File too large. Maximum size is ${MAX_TEXT_SIZE / 1024 / 1024}MB`);
	}

	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file);
	});
}

// ============================================================================
// Image Processing
// ============================================================================

/**
 * Process an image file: resize if needed, compress, and return base64
 */
export async function processImage(file: File): Promise<{ base64: string; previewUrl: string }> {
	if (file.size > MAX_IMAGE_SIZE * 5) {
		// Allow larger initial size, we'll compress
		throw new Error(`Image too large. Maximum size is ${(MAX_IMAGE_SIZE * 5) / 1024 / 1024}MB`);
	}

	return new Promise((resolve, reject) => {
		const img = new Image();
		const objectUrl = URL.createObjectURL(file);

		img.onload = () => {
			URL.revokeObjectURL(objectUrl);

			// Calculate new dimensions
			let { width, height } = img;
			if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
				const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
				width = Math.round(width * ratio);
				height = Math.round(height * ratio);
			}

			// Draw to canvas and compress
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;

			const ctx = canvas.getContext('2d');
			if (!ctx) {
				reject(new Error('Failed to create canvas context'));
				return;
			}

			ctx.drawImage(img, 0, 0, width, height);

			// Get as JPEG for compression (better than PNG for most cases)
			const quality = 0.85;
			const dataUrl = canvas.toDataURL('image/jpeg', quality);

			// Extract base64 without the data: prefix (Ollama requirement)
			const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

			resolve({
				base64,
				previewUrl: dataUrl
			});
		};

		img.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Failed to load image'));
		};

		img.src = objectUrl;
	});
}

// ============================================================================
// PDF Processing
// ============================================================================

// PDF.js will be loaded dynamically when needed
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

/**
 * Load PDF.js library dynamically
 */
async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
	if (pdfjsLib) return pdfjsLib;

	try {
		pdfjsLib = await import('pdfjs-dist');

		// Set worker source using CDN for reliability
		pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

		return pdfjsLib;
	} catch (error) {
		throw new Error('PDF.js library not available. Install with: npm install pdfjs-dist');
	}
}

/**
 * Extract text content from a PDF file
 */
export async function extractPdfText(file: File): Promise<string> {
	if (file.size > MAX_PDF_SIZE) {
		throw new Error(`PDF too large. Maximum size is ${MAX_PDF_SIZE / 1024 / 1024}MB`);
	}

	const pdfjs = await loadPdfJs();

	const arrayBuffer = await file.arrayBuffer();
	const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

	const textParts: string[] = [];

	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const textContent = await page.getTextContent();
		const pageText = textContent.items
			.filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem =>
				'str' in item
			)
			.map((item) => item.str)
			.join(' ');
		textParts.push(pageText);
	}

	return textParts.join('\n\n');
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process a file and create an attachment
 * Handles all file types (image, text, PDF)
 */
export async function processFile(file: File): Promise<ProcessFileOutcome> {
	const type = detectFileType(file);

	if (!type) {
		return {
			success: false,
			error: `Unsupported file type: ${file.type || 'unknown'}`
		};
	}

	const id = crypto.randomUUID();

	try {
		const baseAttachment: FileAttachment = {
			id,
			type,
			filename: file.name,
			mimeType: file.type,
			size: file.size
		};

		switch (type) {
			case 'image': {
				const { base64, previewUrl } = await processImage(file);
				return {
					success: true,
					attachment: {
						...baseAttachment,
						base64Data: base64,
						previewUrl
					}
				};
			}

			case 'text': {
				const textContent = await readTextFile(file);
				return {
					success: true,
					attachment: {
						...baseAttachment,
						textContent
					}
				};
			}

			case 'pdf': {
				const textContent = await extractPdfText(file);
				return {
					success: true,
					attachment: {
						...baseAttachment,
						textContent
					}
				};
			}

			default:
				return {
					success: false,
					error: `Unsupported file type: ${type}`
				};
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error processing file'
		};
	}
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get a file icon based on type
 */
export function getFileIcon(type: AttachmentType): string {
	switch (type) {
		case 'image':
			return '🖼️';
		case 'pdf':
			return '📄';
		case 'text':
			return '📝';
		default:
			return '📎';
	}
}

/**
 * Format attachment content for inclusion in message
 * Prepends file content with a header showing filename
 */
export function formatAttachmentsForMessage(attachments: FileAttachment[]): string {
	return attachments
		.filter((a) => a.textContent)
		.map((a) => `--- ${a.filename} ---\n${a.textContent}`)
		.join('\n\n');
}
