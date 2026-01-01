/**
 * Chat components for Ollama Web UI
 *
 * This module exports all chat-related components for building
 * the conversational interface.
 */

// Main container
export { default as ChatWindow } from './ChatWindow.svelte';

// Message display
export { default as MessageList } from './MessageList.svelte';
export { default as MessageItem } from './MessageItem.svelte';
export { default as MessageContent } from './MessageContent.svelte';
export { default as MessageActions } from './MessageActions.svelte';

// Branch navigation
export { default as BranchNavigator } from './BranchNavigator.svelte';

// Input
export { default as ChatInput } from './ChatInput.svelte';

// Image handling (for vision models)
export { default as ImageUpload } from './ImageUpload.svelte';
export { default as ImagePreview } from './ImagePreview.svelte';

// Code display
export { default as CodeBlock } from './CodeBlock.svelte';

// Indicators and states
export { default as StreamingIndicator } from './StreamingIndicator.svelte';
export { default as EmptyState } from './EmptyState.svelte';

// Context management
export { default as ContextUsageBar } from './ContextUsageBar.svelte';
export { default as ContextFullModal } from './ContextFullModal.svelte';
export { default as SummaryBanner } from './SummaryBanner.svelte';

// Prompt selection
export { default as SystemPromptSelector } from './SystemPromptSelector.svelte';
