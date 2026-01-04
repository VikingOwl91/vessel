<script lang="ts">
	/**
	 * ChatWindow - Main container for the chat interface
	 * Handles sending messages, streaming responses, and tool execution
	 */

	import { chatState, modelsState, conversationsState, toolsState, promptsState, toastState, backendsState } from '$lib/stores';
	import { resolveSystemPrompt } from '$lib/services/prompt-resolution.js';
	import { serverConversationsState } from '$lib/stores/server-conversations.svelte';
	import { streamingMetricsState } from '$lib/stores/streaming-metrics.svelte';
	import { ollamaClient, type StreamChatCallbacks } from '$lib/ollama';
	import { isVLMActive } from '$lib/services/chat-router.js';
	import { addMessage as addStoredMessage, updateConversation, createConversation as createStoredConversation, saveAttachments } from '$lib/storage';
	import type { FileAttachment } from '$lib/types/attachment.js';
	import { fileAnalyzer, analyzeFilesInBatches, formatAnalyzedAttachment, type AnalysisResult } from '$lib/services/fileAnalyzer.js';
	import { attachmentService } from '$lib/services/attachmentService.js';
	import {
		contextManager,
		generateSummary,
		selectMessagesForSummarization,
		calculateTokenSavings,
		formatSummaryAsContext,
		searchSimilar,
		formatResultsAsContext,
		getKnowledgeBaseStats
	} from '$lib/memory';
	import { runToolCalls, formatToolResultsForChat, getFunctionModel, USE_FUNCTION_MODEL } from '$lib/tools';
	import type { OllamaMessage, OllamaToolCall, OllamaToolDefinition, OllamaChatResponse } from '$lib/ollama';
	import type { Conversation } from '$lib/types/conversation';
	import VirtualMessageList from './VirtualMessageList.svelte';
	import ChatInput from './ChatInput.svelte';
	import EmptyState from './EmptyState.svelte';
	import ContextUsageBar from './ContextUsageBar.svelte';
	import ContextFullModal from './ContextFullModal.svelte';
	import SummaryBanner from './SummaryBanner.svelte';
	import StreamingStats from './StreamingStats.svelte';
	import SystemPromptSelector from './SystemPromptSelector.svelte';
	import ModelParametersPanel from '$lib/components/settings/ModelParametersPanel.svelte';
	import { settingsState } from '$lib/stores/settings.svelte';

	/**
	 * Props interface for ChatWindow
	 * - mode: 'new' for new chat page, 'conversation' for existing conversations
	 * - onFirstMessage: callback for when first message is sent in 'new' mode
	 * - conversation: conversation metadata when in 'conversation' mode
	 */
	interface Props {
		mode?: 'new' | 'conversation';
		onFirstMessage?: (content: string, images?: string[], attachments?: FileAttachment[]) => Promise<void>;
		conversation?: Conversation | null;
		/** Bindable prop for thinking mode - synced with parent in 'new' mode */
		thinkingEnabled?: boolean;
	}

	let {
		mode = 'new',
		onFirstMessage,
		conversation,
		thinkingEnabled = $bindable(true)
	}: Props = $props();

	// Local state for abort controller
	let abortController: AbortController | null = $state(null);

	// Summarization state
	let isSummarizing = $state(false);

	// Context full modal state
	let showContextFullModal = $state(false);
	let pendingMessage: { content: string; images?: string[]; attachments?: FileAttachment[] } | null = $state(null);

	// Tool execution state
	let isExecutingTools = $state(false);

	// File analysis state
	let isAnalyzingFiles = $state(false);
	let analyzingFileNames = $state<string[]>([]);

	// RAG (Retrieval-Augmented Generation) state
	let ragEnabled = $state(true);
	let hasKnowledgeBase = $state(false);
	let lastRagContext = $state<string | null>(null);

	// System prompt for new conversations (before a conversation is created)
	let newChatPromptId = $state<string | null>(null);

	// File picker trigger function (bound from ChatInput -> FileUpload)
	let triggerFilePicker: (() => void) | undefined = $state();

	// Derived: Check if selected model supports thinking
	const supportsThinking = $derived.by(() => {
		const caps = modelsState.selectedCapabilities;
		return caps.includes('thinking');
	});

	// Check for knowledge base on mount
	$effect(() => {
		checkKnowledgeBase();
	});

	// Track previous context state for threshold crossing detection
	let previousContextState: 'normal' | 'warning' | 'critical' | 'full' = 'normal';

	// Context warning toasts - show once per threshold crossing
	$effect(() => {
		const percentage = contextManager.contextUsage.percentage;
		let currentState: 'normal' | 'warning' | 'critical' | 'full' = 'normal';

		if (percentage >= 100) {
			currentState = 'full';
		} else if (percentage >= 95) {
			currentState = 'critical';
		} else if (percentage >= 85) {
			currentState = 'warning';
		}

		// Only show toast when crossing INTO a worse state
		if (currentState !== previousContextState) {
			if (currentState === 'warning' && previousContextState === 'normal') {
				toastState.warning('Context is 85% full. Consider starting a new chat soon.');
			} else if (currentState === 'critical' && previousContextState !== 'full') {
				toastState.warning('Context almost full (95%). Summarize or start a new chat.');
			} else if (currentState === 'full') {
				// Full state is handled by the modal, no toast needed
			}
			previousContextState = currentState;
		}
	});

	/**
	 * Check if knowledge base has any documents
	 */
	async function checkKnowledgeBase(): Promise<void> {
		try {
			const stats = await getKnowledgeBaseStats();
			hasKnowledgeBase = stats.documentCount > 0;
		} catch {
			hasKnowledgeBase = false;
		}
	}

	/**
	 * Retrieve relevant context from knowledge base for the query
	 */
	async function retrieveRagContext(query: string): Promise<string | null> {
		if (!ragEnabled || !hasKnowledgeBase) return null;

		try {
			const results = await searchSimilar(query, 3, 0.5);
			if (results.length === 0) return null;

			const context = formatResultsAsContext(results);
			return context;
		} catch (error) {
			console.error('[RAG] Failed to retrieve context:', error);
			return null;
		}
	}

	/**
	 * Convert OllamaToolCall to the format expected by tool executor
	 * Ollama doesn't provide IDs, so we generate them
	 */
	function convertToolCalls(ollamaCalls: OllamaToolCall[]): Array<{ id: string; function: { name: string; arguments: string } }> {
		return ollamaCalls.map((call, index) => ({
			id: `tool-${Date.now()}-${index}`,
			function: {
				name: call.function.name,
				arguments: JSON.stringify(call.function.arguments)
			}
		}));
	}

	/**
	 * Stream chat using the appropriate backend (VLM or Ollama).
	 * Routes to VLM when it's the primary backend, otherwise uses Ollama.
	 */
	async function streamChatWithBackend(
		options: {
			model: string;
			messages: OllamaMessage[];
			tools?: OllamaToolDefinition[];
			think?: boolean;
			options?: Record<string, unknown>;
		},
		callbacks: StreamChatCallbacks,
		signal?: AbortSignal
	): Promise<void> {
		if (isVLMActive()) {
			// Use VLM backend
			const client = backendsState.primary;
			if (!client) throw new Error('No primary backend available');

			await client.streamChatWithCallbacks(
				{
					model: options.model,
					messages: options.messages.map((m) => ({
						role: m.role as 'system' | 'user' | 'assistant' | 'tool',
						content: m.content
					})),
					stream: true,
					options: options.options
						? {
								temperature: options.options.temperature as number | undefined,
								topP: options.options.top_p as number | undefined,
								topK: options.options.top_k as number | undefined,
								maxTokens: options.options.num_predict as number | undefined,
								contextSize: options.options.num_ctx as number | undefined
							}
						: undefined
				},
				{
					onToken: callbacks.onToken,
					onComplete: (response) => {
						callbacks.onComplete?.({
							content: response.message.content,
							response: {
								model: response.model,
								created_at: new Date().toISOString(),
								message: {
									role: response.message.role,
									content: response.message.content
								},
								done: true,
								done_reason: response.doneReason
							} as OllamaChatResponse
						});
					},
					onError: (error) => callbacks.onError?.(new Error(error.message))
				},
				signal
			);
		} else {
			// Use Ollama client
			await ollamaClient.streamChatWithCallbacks(options, callbacks, signal);
		}
	}

	/**
	 * Get tool definitions for the API call
	 */
	function getToolsForApi(): OllamaToolDefinition[] | undefined {
		if (!toolsState.toolsEnabled) return undefined;
		const tools = toolsState.getEnabledToolDefinitions();
		return tools.length > 0 ? tools as OllamaToolDefinition[] : undefined;
	}

	// Derived: Check if there are any messages
	const hasMessages = $derived(chatState.visibleMessages.length > 0);

	// Update context manager when model changes
	$effect(() => {
		const model = modelsState.selectedId;
		if (model) {
			contextManager.setModel(model);
		}
	});

	// Sync custom context limit with settings
	$effect(() => {
		if (settingsState.useCustomParameters) {
			contextManager.setCustomContextLimit(settingsState.num_ctx);
		} else {
			contextManager.setCustomContextLimit(null);
		}
	});

	// Update context manager when messages change
	$effect(() => {
		contextManager.updateMessages(chatState.visibleMessages);
	});

	// Invalidate streaming message token cache on content update
	// Only do this occasionally (the throttling in contextManager handles the rest)
	$effect(() => {
		if (chatState.streamingMessageId && chatState.streamBuffer) {
			contextManager.invalidateMessage(chatState.streamingMessageId);
		}
	});

	// Flush pending context updates when streaming finishes
	$effect(() => {
		if (!chatState.isStreaming) {
			// Force a full context update when streaming ends
			contextManager.flushPendingUpdate();
			contextManager.updateMessages(chatState.visibleMessages, true);
		}
	});

	/**
	 * Convert chat state messages to Ollama API format
	 * Uses messagesForContext to exclude summarized originals but include summaries
	 * Now includes attachment content loaded from IndexedDB
	 */
	async function getMessagesForApi(): Promise<OllamaMessage[]> {
		const messages: OllamaMessage[] = [];

		for (const node of chatState.messagesForContext) {
			let content = node.message.content;
			let images = node.message.images;

			// Load attachment content if present
			if (node.message.attachmentIds && node.message.attachmentIds.length > 0) {
				// Load text content from attachments
				const attachmentContent = await attachmentService.buildOllamaContent(node.message.attachmentIds);
				if (attachmentContent) {
					content = content + '\n\n' + attachmentContent;
				}

				// Load image base64 from attachments
				const attachmentImages = await attachmentService.buildOllamaImages(node.message.attachmentIds);
				if (attachmentImages.length > 0) {
					images = [...(images || []), ...attachmentImages];
				}
			}

			messages.push({
				role: node.message.role as OllamaMessage['role'],
				content,
				images
			});
		}

		return messages;
	}

	/**
	 * Handle summarization of older messages
	 */
	async function handleSummarize(): Promise<void> {
		const selectedModel = modelsState.selectedId;
		if (!selectedModel || isSummarizing) return;

		const messages = chatState.visibleMessages;
		const { toSummarize, toKeep } = selectMessagesForSummarization(messages, 0);

		if (toSummarize.length === 0) {
			toastState.warning('No messages available to summarize');
			return;
		}

		isSummarizing = true;

		try {
			// Generate summary using the LLM
			const summary = await generateSummary(toSummarize, selectedModel);

			// Calculate savings for logging
			const savedTokens = calculateTokenSavings(toSummarize, summary);

			// Mark original messages as summarized (they'll be hidden from UI and context)
			const messageIdsToSummarize = toSummarize.map((node) => node.id);
			chatState.markAsSummarized(messageIdsToSummarize);

			// Insert the summary message at the beginning (after any system messages)
			chatState.insertSummaryMessage(summary);

			// Force context recalculation with updated message list
			contextManager.updateMessages(chatState.visibleMessages, true);

			// Show success notification
			toastState.success(
				`Summarized ${toSummarize.length} messages, saved ~${Math.round(savedTokens / 100) * 100} tokens`
			);
		} catch (error) {
			console.error('Summarization failed:', error);
			toastState.error('Summarization failed. Please try again.');
		} finally {
			isSummarizing = false;
		}
	}

	/**
	 * Handle automatic compaction of older messages
	 * Called after assistant response completes when auto-compact is enabled
	 */
	async function handleAutoCompact(): Promise<void> {
		// Check if auto-compact should be triggered
		if (!contextManager.shouldAutoCompact()) return;

		const selectedModel = modelsState.selectedId;
		if (!selectedModel || isSummarizing) return;

		const messages = chatState.visibleMessages;
		const preserveCount = contextManager.getAutoCompactPreserveCount();
		const { toSummarize } = selectMessagesForSummarization(messages, 0, preserveCount);

		if (toSummarize.length < 2) return;

		isSummarizing = true;

		try {
			// Generate summary using the LLM
			const summary = await generateSummary(toSummarize, selectedModel);

			// Mark original messages as summarized
			const messageIdsToSummarize = toSummarize.map((node) => node.id);
			chatState.markAsSummarized(messageIdsToSummarize);

			// Insert the summary message (inline indicator will be shown by MessageList)
			chatState.insertSummaryMessage(summary);

			// Force context recalculation
			contextManager.updateMessages(chatState.visibleMessages, true);

			// Subtle notification for auto-compact (inline indicator is the primary feedback)
			console.log(`[Auto-compact] Summarized ${toSummarize.length} messages`);
		} catch (error) {
			console.error('[Auto-compact] Failed:', error);
			// Silent failure for auto-compact - don't interrupt user flow
		} finally {
			isSummarizing = false;
		}
	}

	// =========================================================================
	// Context Full Modal Handlers
	// =========================================================================

	/**
	 * Handle "Summarize & Continue" from context full modal
	 */
	async function handleContextFullSummarize(): Promise<void> {
		showContextFullModal = false;
		await handleSummarize();

		// After summarization, try to send the pending message
		if (pendingMessage && contextManager.contextUsage.percentage < 100) {
			const { content, images, attachments } = pendingMessage;
			pendingMessage = null;
			await handleSendMessage(content, images, attachments);
		} else if (pendingMessage) {
			// Still full after summarization - show toast
			toastState.warning('Context still full after summarization. Try starting a new chat.');
			pendingMessage = null;
		}
	}

	/**
	 * Handle "Start New Chat" from context full modal
	 */
	function handleContextFullNewChat(): void {
		showContextFullModal = false;
		pendingMessage = null;
		chatState.reset();
		contextManager.reset();
		toastState.info('Started new chat. Previous conversation was saved.');
	}

	/**
	 * Handle "Continue Anyway" from context full modal
	 */
	async function handleContextFullDismiss(): Promise<void> {
		showContextFullModal = false;

		// Try to send the message anyway (may fail or get truncated)
		if (pendingMessage) {
			const { content, images, attachments } = pendingMessage;
			pendingMessage = null;
			// Bypass the context check by calling the inner logic directly
			await sendMessageInternal(content, images, attachments);
		}
	}

	/**
	 * Check if summarization is possible (enough messages)
	 */
	const canSummarizeConversation = $derived(chatState.visibleMessages.length >= 6);

	/**
	 * Send a message - checks context and may show modal
	 */
	async function handleSendMessage(content: string, images?: string[], attachments?: FileAttachment[]): Promise<void> {
		const selectedModel = modelsState.selectedId;

		if (!selectedModel) {
			toastState.error('Please select a model first');
			return;
		}

		// Check if context is full (100%+)
		if (contextManager.contextUsage.percentage >= 100) {
			// Store pending message and show modal
			pendingMessage = { content, images, attachments };
			showContextFullModal = true;
			return;
		}

		await sendMessageInternal(content, images, attachments);
	}

	/**
	 * Internal: Send message and stream response (bypasses context check)
	 */
	async function sendMessageInternal(content: string, images?: string[], attachments?: FileAttachment[]): Promise<void> {
		const selectedModel = modelsState.selectedId;
		if (!selectedModel) return;

		// In 'new' mode with no messages yet, create conversation first
		if (mode === 'new' && !hasMessages && onFirstMessage) {
			await onFirstMessage(content, images, attachments);
			return;
		}

		let conversationId = chatState.conversationId;

		// Auto-create conversation if none exists (fallback for edge cases)
		if (!conversationId) {
			const title = content.length > 50 ? content.substring(0, 47) + '...' : content;
			const result = await createStoredConversation({
				title,
				model: selectedModel,
				isPinned: false,
				isArchived: false
			});

			if (result.success) {
				conversationId = result.data.id;
				chatState.conversationId = conversationId;
				conversationsState.add(result.data);
			}
		}

		// Collect attachment IDs if we have attachments to save
		let attachmentIds: string[] | undefined;
		if (attachments && attachments.length > 0) {
			attachmentIds = attachments.map(a => a.id);
		}

		// Add user message to tree (including attachmentIds for display)
		const userMessageId = chatState.addMessage({
			role: 'user',
			content,
			images,
			attachmentIds
		});

		// Persist user message and attachments to IndexedDB
		if (conversationId) {
			const parentId = chatState.activePath.length >= 2
				? chatState.activePath[chatState.activePath.length - 2]
				: null;

			// Save attachments first (they need the messageId)
			if (attachments && attachments.length > 0) {
				// Use original File objects for storage (preserves binary data)
				const files = attachments.map((a) => {
					if (a.originalFile) {
						return a.originalFile;
					}
					// Fallback: reconstruct from processed data (shouldn't be needed normally)
					if (a.base64Data) {
						const binary = atob(a.base64Data);
						const bytes = new Uint8Array(binary.length);
						for (let i = 0; i < binary.length; i++) {
							bytes[i] = binary.charCodeAt(i);
						}
						return new File([bytes], a.filename, { type: a.mimeType });
					}
					// For text/PDF without original, create placeholder (download won't work)
					console.warn(`No original file for attachment ${a.filename}, download may not work`);
					return new File([a.textContent || ''], a.filename, { type: a.mimeType });
				});

				const saveResult = await saveAttachments(userMessageId, files, attachments);
				if (!saveResult.success) {
					console.error('Failed to save attachments:', saveResult.error);
				}
			}

			// Save message with attachmentIds
			await addStoredMessage(conversationId, { role: 'user', content, images, attachmentIds }, parentId, userMessageId);
		}

		// Process attachments if any
		let contentForOllama = content;
		let processingMessageId: string | undefined;

		if (attachments && attachments.length > 0) {
			// Show processing indicator - this message will become the assistant response
			isAnalyzingFiles = true;
			analyzingFileNames = attachments.map(a => a.filename);
			processingMessageId = chatState.startStreaming();
			const fileCount = attachments.length;
			const fileLabel = fileCount === 1 ? 'file' : 'files';
			chatState.setStreamContent(`Processing ${fileCount} ${fileLabel}...`);

			try {
				// Check if any files need actual LLM analysis
				// Force analysis when >3 files to prevent context overflow (max 5 files allowed)
				const forceAnalysis = attachments.length > 3;
				const filesToAnalyze = forceAnalysis
					? attachments.filter(a => a.textContent && a.textContent.length > 2000)
					: attachments.filter(a => fileAnalyzer.shouldAnalyze(a));

				if (filesToAnalyze.length > 0) {
					// Update indicator to show analysis
					chatState.setStreamContent(`Analyzing ${filesToAnalyze.length} ${filesToAnalyze.length === 1 ? 'file' : 'files'}...`);

					const analysisResults = await analyzeFilesInBatches(filesToAnalyze, selectedModel, 3);

					// Update attachments with results
					filesToAnalyze.forEach((file) => {
						const result = analysisResults.get(file.id);
						if (result) {
							file.analyzed = result.analyzed;
							file.summary = result.summary;
						}
					});

					// Build formatted content with file summaries
					const formattedParts: string[] = [content];

					for (const attachment of attachments) {
						const result = analysisResults.get(attachment.id);
						if (result) {
							formattedParts.push(formatAnalyzedAttachment(attachment, result));
						} else if (attachment.textContent) {
							// Non-analyzed text attachment
							formattedParts.push(`<file name="${attachment.filename}">\n${attachment.textContent}\n</file>`);
						}
					}

					contentForOllama = formattedParts.join('\n\n');
				} else {
					// No files need analysis, format with content
					const parts: string[] = [content];
					for (const a of attachments) {
						if (a.textContent) {
							parts.push(`<file name="${a.filename}">\n${a.textContent}\n</file>`);
						}
					}
					contentForOllama = parts.join('\n\n');
				}

				// Keep "Processing..." visible - LLM streaming will replace it

			} catch (error) {
				console.error('[ChatWindow] File processing failed:', error);
				chatState.setStreamContent('Processing failed, proceeding with original content...');
				await new Promise(r => setTimeout(r, 1000));

				// Fallback: use original content with raw file text
				const parts: string[] = [content];
				for (const a of attachments) {
					if (a.textContent) {
						parts.push(`<file name="${a.filename}">\n${a.textContent}\n</file>`);
					}
				}
				contentForOllama = parts.join('\n\n');
			} finally {
				isAnalyzingFiles = false;
				analyzingFileNames = [];
			}
		}

		// Stream assistant message (reuse processing message if it exists)
		await streamAssistantResponse(selectedModel, userMessageId, conversationId, contentForOllama, processingMessageId);
	}

	/**
	 * Stream assistant response with tool call handling and RAG context
	 * @param contentOverride Optional content to use instead of the last user message content (for formatted attachments)
	 */
	async function streamAssistantResponse(
		model: string,
		parentMessageId: string,
		conversationId: string | null,
		contentOverride?: string,
		existingMessageId?: string
	): Promise<void> {
		// Reuse existing message (e.g., from "Processing..." indicator) or create new one
		const assistantMessageId = existingMessageId || chatState.startStreaming();
		abortController = new AbortController();

		// Track if we need to clear the "Processing..." text on first token
		let needsClearOnFirstToken = !!existingMessageId;

		// Start streaming metrics tracking
		streamingMetricsState.startStream();

		// Track tool calls received during streaming
		let pendingToolCalls: OllamaToolCall[] | null = null;

		try {
			let messages = await getMessagesForApi();
			const tools = getToolsForApi();

			// If we have a content override (formatted attachments), replace the last user message content
			if (contentOverride && messages.length > 0) {
				const lastUserIndex = messages.findLastIndex(m => m.role === 'user');
				if (lastUserIndex !== -1) {
					messages = [
						...messages.slice(0, lastUserIndex),
						{ ...messages[lastUserIndex], content: contentOverride },
						...messages.slice(lastUserIndex + 1)
					];
				}
			}

			// Build system prompt from resolution service + RAG context
			const systemParts: string[] = [];

			// Resolve system prompt using priority chain:
			// 1. Per-conversation prompt
			// 2. New chat selection
			// 3. Model-prompt mapping
			// 4. Model-embedded prompt (from Modelfile)
			// 5. Capability-matched prompt
			// 6. Global active prompt
			// 7. None
			const resolvedPrompt = await resolveSystemPrompt(
				model,
				conversation?.systemPromptId,
				newChatPromptId
			);

			if (resolvedPrompt.content) {
				systemParts.push(resolvedPrompt.content);
			}

			// RAG: Retrieve relevant context for the last user message
			const lastUserMessage = messages.filter(m => m.role === 'user').pop();
			if (lastUserMessage && ragEnabled && hasKnowledgeBase) {
				const ragContext = await retrieveRagContext(lastUserMessage.content);
				if (ragContext) {
					lastRagContext = ragContext;
					systemParts.push(`You have access to a knowledge base. Use the following relevant context to help answer the user's question. If the context isn't relevant, you can ignore it.\n\n${ragContext}`);
				}
			}

			// Always add language instruction
			systemParts.push('Always respond in the same language the user writes in. Default to English if unclear.');

			// Inject combined system message
			if (systemParts.length > 0) {
				const systemMessage: OllamaMessage = {
					role: 'system',
					content: systemParts.join('\n\n---\n\n')
				};
				messages = [systemMessage, ...messages];
			}

			// Use function model for tool routing if enabled and tools are present
			const chatModel = (tools && tools.length > 0 && USE_FUNCTION_MODEL)
				? getFunctionModel(model)
				: model;

			// Determine if we should use native thinking mode
			const useNativeThinking = supportsThinking && thinkingEnabled;

			// Track thinking content during streaming
			let streamingThinking = '';
			let thinkingClosed = false;

			await streamChatWithBackend(
				{
					model: chatModel,
					messages,
					tools: isVLMActive() ? undefined : tools, // VLM doesn't support tools yet
					think: isVLMActive() ? false : useNativeThinking, // VLM doesn't support thinking
					options: settingsState.apiParameters
				},
				{
					onThinkingToken: (token) => {
						// Clear "Processing..." on first token
						if (needsClearOnFirstToken) {
							chatState.setStreamContent('');
							needsClearOnFirstToken = false;
						}
						// Accumulate thinking and update the message
						if (!streamingThinking) {
							// Start the thinking block
							chatState.appendToStreaming('<think>');
						}
						streamingThinking += token;
						chatState.appendToStreaming(token);
						// Track thinking tokens for metrics
						streamingMetricsState.incrementTokens();
					},
					onToken: (token) => {
						// Clear "Processing..." on first token
						if (needsClearOnFirstToken) {
							chatState.setStreamContent('');
							needsClearOnFirstToken = false;
						}
						// Close thinking block when content starts
						if (streamingThinking && !thinkingClosed) {
							chatState.appendToStreaming('</think>\n\n');
							thinkingClosed = true;
						}
						chatState.appendToStreaming(token);
						// Track content tokens for metrics
						streamingMetricsState.incrementTokens();
					},
					onToolCall: (toolCalls) => {
						// Store tool calls to process after streaming completes
						pendingToolCalls = toolCalls;
					},
					onComplete: async () => {
						// Close thinking block if it was opened but not closed (e.g., tool calls without content)
						if (streamingThinking && !thinkingClosed) {
							chatState.appendToStreaming('</think>\n\n');
							thinkingClosed = true;
						}

						chatState.finishStreaming();
						streamingMetricsState.endStream();
						abortController = null;

						// Handle tool calls if received
						if (pendingToolCalls && pendingToolCalls.length > 0) {
							await executeToolsAndContinue(
								model,
								assistantMessageId,
								pendingToolCalls,
								conversationId
							);
							return; // Tool continuation handles persistence
						}

						// Persist assistant message to IndexedDB with the SAME ID as chatState
						if (conversationId) {
							const node = chatState.messageTree.get(assistantMessageId);
							if (node) {
								await addStoredMessage(
									conversationId,
									{ role: 'assistant', content: node.message.content },
									parentMessageId,
									assistantMessageId
								);
								await updateConversation(conversationId, {});
								conversationsState.update(conversationId, {});
							}
						}

						// Check for auto-compact after response completes
						await handleAutoCompact();
					},
					onError: (error) => {
						console.error('Streaming error:', error);
						// Show error to user instead of leaving "Processing..."
						const errorMsg = error instanceof Error ? error.message : 'Unknown error';
						chatState.setStreamContent(`⚠️ Error: ${errorMsg}`);
						chatState.finishStreaming();
						streamingMetricsState.endStream();
						abortController = null;
					}
				},
				abortController.signal
			);
		} catch (error) {
			console.error('Failed to send message:', error);
			// Show error to user
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			chatState.setStreamContent(`⚠️ Error: ${errorMsg}`);
			toastState.error('Failed to send message. Please try again.');
			chatState.finishStreaming();
			streamingMetricsState.endStream();
			abortController = null;
		}
	}

	/**
	 * Execute tool calls and continue the conversation with results
	 */
	async function executeToolsAndContinue(
		model: string,
		assistantMessageId: string,
		toolCalls: OllamaToolCall[],
		conversationId: string | null
	): Promise<void> {
		isExecutingTools = true;

		try {
			// Convert tool calls to executor format with stable IDs
			const callIds = toolCalls.map(() => crypto.randomUUID());
			const convertedCalls = toolCalls.map((tc, i) => ({
				id: callIds[i],
				name: tc.function.name,
				arguments: tc.function.arguments
			}));

			// Execute all tools (including custom tools)
			const results = await runToolCalls(convertedCalls, undefined, toolsState.customTools);

			// Format results for model context (still needed for LLM to respond)
			const toolResultContent = formatToolResultsForChat(results);

			// Update the assistant message with structured tool call data (including results)
			const assistantNode = chatState.messageTree.get(assistantMessageId);
			if (assistantNode) {
				// Store structured tool call data WITH results for display
				// Results are shown collapsed in ToolCallDisplay - NOT as raw message content
				assistantNode.message.toolCalls = toolCalls.map((tc, i) => {
					const result = results[i];
					return {
						id: callIds[i],
						name: tc.function.name,
						arguments: JSON.stringify(tc.function.arguments),
						result: result.success ? (typeof result.result === 'object' ? JSON.stringify(result.result) : String(result.result)) : undefined,
						error: result.success ? undefined : result.error
					};
				});

				// DON'T add tool results to message content - that's what floods the UI
				// The results are stored in toolCalls and displayed by ToolCallDisplay
			}

			// Persist the assistant message (including toolCalls for reload persistence)
			if (conversationId && assistantNode) {
				const parentOfAssistant = assistantNode.parentId;
				await addStoredMessage(
					conversationId,
					{
						role: 'assistant',
						content: assistantNode.message.content,
						toolCalls: assistantNode.message.toolCalls
					},
					parentOfAssistant,
					assistantMessageId
				);
			}

			// Add tool results as a hidden message (for model context, not displayed in UI)
			const toolMessageId = chatState.addMessage({
				role: 'user',
				content: `Tool execution results:\n${toolResultContent}\n\nBased on these results, either provide a helpful response OR call another tool if you need more information.`,
				hidden: true
			});

			if (conversationId) {
				await addStoredMessage(
					conversationId,
					{ role: 'user', content: `Tool execution results:\n${toolResultContent}` },
					assistantMessageId,
					toolMessageId
				);
			}

			// Stream the final response
			await streamAssistantResponse(model, toolMessageId, conversationId);

		} catch (error) {
			toastState.error('Tool execution failed');
			// Update assistant message with error
			const node = chatState.messageTree.get(assistantMessageId);
			if (node) {
				node.message.content = `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
			}
		} finally {
			isExecutingTools = false;
		}
	}

	/**
	 * Stop the current streaming response
	 */
	function handleStopStreaming(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		chatState.finishStreaming();
	}

	/**
	 * Regenerate the last assistant response
	 * Creates a new sibling message for the assistant response and streams a new answer
	 */
	async function handleRegenerate(): Promise<void> {
		if (!chatState.canRegenerate) return;

		const selectedModel = modelsState.selectedId;
		if (!selectedModel) return;

		// Get the last message (should be an assistant message)
		const lastMessageId = chatState.activePath[chatState.activePath.length - 1];
		const lastNode = chatState.messageTree.get(lastMessageId);
		if (!lastNode || lastNode.message.role !== 'assistant') return;

		const conversationId = chatState.conversationId;

		// Use the new startRegeneration method which creates a sibling and sets up streaming
		const newMessageId = chatState.startRegeneration(lastMessageId);
		if (!newMessageId) {
			toastState.error('Failed to regenerate response');
			return;
		}

		// Get the parent user message for context
		const parentUserMessage = chatState.getParentUserMessage(newMessageId);
		const parentUserMessageId = parentUserMessage?.id;

		abortController = new AbortController();

		// Start streaming metrics tracking
		streamingMetricsState.startStream();

		// Track tool calls received during streaming
		let pendingToolCalls: OllamaToolCall[] | null = null;

		try {
			// Get messages for API - excludes the current empty assistant message being streamed
			const messages = (await getMessagesForApi()).filter(m => m.content !== '');
			const tools = getToolsForApi();

			// Use function model for tool routing if enabled and tools are present
			const chatModel = (tools && tools.length > 0 && USE_FUNCTION_MODEL)
				? getFunctionModel(selectedModel)
				: selectedModel;

			await streamChatWithBackend(
				{
					model: chatModel,
					messages,
					tools: isVLMActive() ? undefined : tools, // VLM doesn't support tools yet
					options: settingsState.apiParameters
				},
				{
					onToken: (token) => {
						chatState.appendToStreaming(token);
						streamingMetricsState.incrementTokens();
					},
					onToolCall: (toolCalls) => {
						pendingToolCalls = toolCalls;
					},
					onComplete: async () => {
						chatState.finishStreaming();
						streamingMetricsState.endStream();
						abortController = null;

						// Handle tool calls if received
						if (pendingToolCalls && pendingToolCalls.length > 0) {
							await executeToolsAndContinue(
								selectedModel,
								newMessageId,
								pendingToolCalls,
								conversationId
							);
							return;
						}

						// Persist regenerated assistant message to IndexedDB with the SAME ID
						if (conversationId && parentUserMessageId) {
							const node = chatState.messageTree.get(newMessageId);
							if (node) {
								await addStoredMessage(
									conversationId,
									{ role: 'assistant', content: node.message.content },
									parentUserMessageId,
									newMessageId
								);
								// Update conversation timestamp
								await updateConversation(conversationId, {});
								conversationsState.update(conversationId, {});
							}
						}
					},
					onError: (error) => {
						console.error('Regenerate error:', error);
						const errorMsg = error instanceof Error ? error.message : 'Unknown error';
						chatState.setStreamContent(`⚠️ Error: ${errorMsg}`);
						chatState.finishStreaming();
						streamingMetricsState.endStream();
						abortController = null;
					}
				},
				abortController.signal
			);
		} catch (error) {
			console.error('Failed to regenerate:', error);
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			chatState.setStreamContent(`⚠️ Error: ${errorMsg}`);
			toastState.error('Failed to regenerate. Please try again.');
			chatState.finishStreaming();
			streamingMetricsState.endStream();
			abortController = null;
		}
	}

	/**
	 * Edit a user message and regenerate
	 * Creates a new sibling user message and triggers a new assistant response
	 */
	async function handleEditMessage(messageId: string, newContent: string): Promise<void> {
		const selectedModel = modelsState.selectedId;
		if (!selectedModel) return;

		// Find the message
		const node = chatState.messageTree.get(messageId);
		if (!node || node.message.role !== 'user') return;

		const conversationId = chatState.conversationId;

		// Use the new startEditWithNewBranch method which creates a sibling user message
		const newUserMessageId = chatState.startEditWithNewBranch(
			messageId,
			newContent,
			node.message.images
		);

		if (!newUserMessageId) {
			toastState.error('Failed to edit message');
			return;
		}

		// Persist the new user message to IndexedDB with the SAME ID
		if (conversationId) {
			// Get the parent of the original message (which is also the parent of our new message)
			const parentId = node.parentId;
			await addStoredMessage(
				conversationId,
				{ role: 'user', content: newContent, images: node.message.images },
				parentId,
				newUserMessageId
			);
		}

		// Stream the response using the shared function (with tool support)
		await streamAssistantResponse(selectedModel, newUserMessageId, conversationId);
	}
</script>

<div class="flex h-full flex-col bg-theme-primary">
	{#if hasMessages}
		<div class="flex-1 overflow-hidden">
			<VirtualMessageList
				onRegenerate={handleRegenerate}
				onEditMessage={handleEditMessage}
				showThinking={thinkingEnabled}
			/>
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center">
			<EmptyState />
		</div>
	{/if}

	<!-- Input area with subtle gradient fade -->
	<div class="relative">
		<!-- Gradient fade at top -->
		<div class="pointer-events-none absolute -top-8 left-0 right-0 h-8 bg-gradient-to-t from-[var(--color-bg-primary)] to-transparent"></div>

		<div class="border-t border-theme bg-theme-primary/95 backdrop-blur-sm">
			<!-- Summary recommendation banner -->
			<SummaryBanner onSummarize={handleSummarize} isLoading={isSummarizing} />

			<!-- Context usage indicator -->
			{#if hasMessages}
				<div class="px-4 pt-3">
					<ContextUsageBar />
				</div>
			{/if}

			<!-- Streaming performance stats -->
			<div class="flex justify-center px-4 pt-2">
				<StreamingStats />
			</div>

			<!-- Chat options bar: [Custom] [System Prompt] ... [Attach] [Thinking] -->
			<div class="flex items-center justify-between gap-3 px-4 pt-3">
				<!-- Left side: Settings gear + System prompt selector -->
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => settingsState.togglePanel()}
						class="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-primary"
						class:bg-theme-secondary={settingsState.isPanelOpen}
						class:text-sky-400={settingsState.isPanelOpen || settingsState.useCustomParameters}
						aria-label="Toggle model parameters"
						aria-expanded={settingsState.isPanelOpen}
					>
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						{#if settingsState.useCustomParameters}
							<span class="text-[10px]">Custom</span>
						{/if}
					</button>

					<!-- System prompt selector -->
					{#if mode === 'conversation' && conversation}
						<SystemPromptSelector
							conversationId={conversation.id}
							currentPromptId={conversation.systemPromptId}
							modelName={modelsState.selectedId ?? undefined}
						/>
					{:else if mode === 'new'}
						<SystemPromptSelector
							currentPromptId={newChatPromptId}
							modelName={modelsState.selectedId ?? undefined}
							onSelect={(promptId) => (newChatPromptId = promptId)}
						/>
					{/if}
				</div>

				<!-- Right side: Attach files + Thinking mode toggle -->
				<div class="flex items-center gap-3">
					<!-- Attach files button -->
					<button
						type="button"
						onclick={() => triggerFilePicker?.()}
						disabled={!modelsState.selectedId}
						class="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-primary disabled:cursor-not-allowed disabled:opacity-50"
						aria-label="Attach files"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
							<path fill-rule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clip-rule="evenodd" />
						</svg>
						<span>Attach</span>
					</button>

					<!-- Thinking mode toggle -->
					{#if supportsThinking}
						<label class="flex cursor-pointer items-center gap-2 text-xs text-theme-muted">
							<span class="flex items-center gap-1">
								<span class="text-amber-400">🧠</span>
								Thinking
							</span>
							<button
								type="button"
								role="switch"
								aria-checked={thinkingEnabled}
								onclick={() => (thinkingEnabled = !thinkingEnabled)}
								class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-theme-primary {thinkingEnabled ? 'bg-amber-600' : 'bg-theme-tertiary'}"
							>
								<span
									class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {thinkingEnabled ? 'translate-x-4' : 'translate-x-0'}"
								></span>
							</button>
						</label>
					{/if}
				</div>
			</div>

			<!-- Model parameters panel -->
			<div class="px-4 pt-2">
				<ModelParametersPanel />
			</div>

			<div class="px-4 pb-4 pt-2">
				<ChatInput
					onSend={handleSendMessage}
					onStop={handleStopStreaming}
					isStreaming={chatState.isStreaming}
					disabled={!modelsState.selectedId}
					hideAttachButton={true}
					bind:triggerFilePicker
				/>
			</div>
		</div>
	</div>
</div>

<!-- Context full modal -->
<ContextFullModal
	isOpen={showContextFullModal}
	onSummarize={handleContextFullSummarize}
	onNewChat={handleContextFullNewChat}
	onDismiss={handleContextFullDismiss}
	{isSummarizing}
	canSummarize={canSummarizeConversation}
/>
