/**
 * Utils index
 * Re-exports all utility functions
 */

export {
	type ExportFormat,
	type ExportedConversation,
	type ExportedMessage,
	type ShareableData,
	exportAsMarkdown,
	exportAsJSON,
	generatePreview,
	downloadFile,
	generateFilename,
	exportConversation,
	createShareableData,
	encodeShareableData,
	decodeShareableData,
	generateShareUrl,
	copyToClipboard
} from './export.js';

export {
	keyboardShortcuts,
	isPrimaryModifier,
	getPrimaryModifierDisplay,
	formatShortcut,
	getShortcuts,
	type Shortcut,
	type Modifiers
} from './keyboard.js';

export {
	detectFileType,
	readTextFile,
	processImage,
	extractPdfText,
	processFile,
	formatFileSize,
	getFileIcon,
	formatAttachmentsForMessage
} from './file-processor.js';
