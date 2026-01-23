<script lang="ts">
	/**
	 * Home/new chat page
	 * Shows ChatWindow in "new chat" mode with welcome state
	 * When first message sent, creates conversation and continues streaming here
	 */

	import { onMount } from 'svelte';
	import { chatState, conversationsState, modelsState, toolsState, promptsState } from '$lib/stores';
	import { backendsState } from '$lib/stores/backends.svelte';
	import { resolveSystemPrompt } from '$lib/services/prompt-resolution.js';
	import { streamingMetricsState } from '$lib/stores/streaming-metrics.svelte';
	import { settingsState } from '$lib/stores/settings.svelte';
	import { createConversation as createStoredConversation, addMessage as addStoredMessage, updateConversation, saveAttachments } from '$lib/storage';
	import { ollamaClient } from '$lib/ollama';
	import { unifiedLLMClient } from '$lib/llm';
	import type { OllamaMessage, OllamaToolDefinition, OllamaToolCall } from '$lib/ollama';
	import { getFunctionModel, USE_FUNCTION_MODEL, runToolCalls, formatToolResultsForChat } from '$lib/tools';
	import { searchSimilar, formatResultsAsContext, getKnowledgeBaseStats } from '$lib/memory';
	import ChatWindow from '$lib/components/chat/ChatWindow.svelte';
	import type { Conversation } from '$lib/types/conversation';
	import type { FileAttachment } from '$lib/types/attachment.js';
	import { fileAnalyzer, analyzeFilesInBatches, formatAnalyzedAttachment, type AnalysisResult } from '$lib/services/fileAnalyzer.js';
	import { replaceState } from '$app/navigation';

	// RAG state
	let ragEnabled = $state(true);
	let hasKnowledgeBase = $state(false);

	// Thinking mode state (for reasoning models)
	let thinkingEnabled = $state(true);

	// File analysis state
	let isAnalyzingFiles = $state(false);
	let analyzingFileNames = $state<string[]>([]);

	// Derived: Check if selected model supports thinking
	const supportsThinking = $derived.by(() => {
		const caps = modelsState.selectedCapabilities;
		return caps.includes('thinking');
	});

	/**
	 * Get tool definitions for the API call
	 */
	function getToolsForApi(): OllamaToolDefinition[] | undefined {
		if (!toolsState.toolsEnabled) return undefined;
		const tools = toolsState.getEnabledToolDefinitions();
		return tools.length > 0 ? tools as OllamaToolDefinition[] : undefined;
	}

	// Reset chat state and check knowledge base on mount
	onMount(() => {
		chatState.reset();
		checkKnowledgeBase();
	});

	async function checkKnowledgeBase(): Promise<void> {
		try {
			const stats = await getKnowledgeBaseStats();
			hasKnowledgeBase = stats.documentCount > 0;
		} catch {
			hasKnowledgeBase = false;
		}
	}

	async function retrieveRagContext(query: string): Promise<string | null> {
		if (!ragEnabled || !hasKnowledgeBase) return null;
		try {
			// Search global documents only (null projectId) for home page
			// Lower threshold (0.3) to catch more relevant results
			const results = await searchSimilar(query, { topK: 5, threshold: 0.3, projectId: null });
			if (results.length === 0) return null;
			return formatResultsAsContext(results);
		} catch {
			return null;
		}
	}

	/**
	 * Handle first message submission
	 * Creates a new conversation and starts streaming the response
	 */
	async function handleFirstMessage(content: string, images?: string[], attachments?: FileAttachment[]): Promise<void> {
		// Get model name based on active backend
		let model: string | null = null;

		if (backendsState.activeType === 'ollama') {
			model = modelsState.selectedId;
		} else if (backendsState.activeType === 'llamacpp' || backendsState.activeType === 'lmstudio') {
			// For OpenAI-compatible backends, fetch model from the unified API
			try {
				const response = await fetch('/api/v1/ai/models');
				if (response.ok) {
					const data = await response.json();
					if (data.models && data.models.length > 0) {
						model = data.models[0].name;
					}
				}
			} catch (err) {
				console.error('Failed to get model from backend:', err);
			}
		}

		if (!model) {
			console.error('No model available');
			return;
		}

		const title = generateTitle(content);

		// Create conversation in IndexedDB
		const storageResult = await createStoredConversation({
			title,
			model,
			isPinned: false,
			isArchived: false
		});

		if (!storageResult.success) {
			console.error('Failed to create conversation:', storageResult.error);
			return;
		}

		const conversation = storageResult.data;
		const conversationId = conversation.id;

		// Add to conversations list (immediately updates sidenav via local state)
		conversationsState.add(conversation);

		// Update browser tab title
		currentTitle = title;

		// Set up chat state for the new conversation
		chatState.conversationId = conversationId;

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

		// Save attachments to IndexedDB
		if (attachments && attachments.length > 0) {
			const files = await Promise.all(attachments.map(async (a) => {
				if (a.base64Data) {
					const binary = atob(a.base64Data);
					const bytes = new Uint8Array(binary.length);
					for (let i = 0; i < binary.length; i++) {
						bytes[i] = binary.charCodeAt(i);
					}
					return new File([bytes], a.filename, { type: a.mimeType });
				} else if (a.textContent) {
					return new File([a.textContent], a.filename, { type: a.mimeType });
				} else {
					return new File([], a.filename, { type: a.mimeType });
				}
			}));

			const saveResult = await saveAttachments(userMessageId, files, attachments);
			if (!saveResult.success) {
				console.error('Failed to save attachments:', saveResult.error);
			}
		}

		// Persist user message to IndexedDB with the SAME ID as chatState
		await addStoredMessage(conversationId, { role: 'user', content, images, attachmentIds }, null, userMessageId);

		// NOTE: URL update moved to onComplete to avoid aborting the stream
		// The URL will update after the first response completes

		// Process attachments if any
		let contentForOllama = content;
		let assistantMessageId: string | null = null;

		if (attachments && attachments.length > 0) {
			// Show processing indicator - this message will become the assistant response
			isAnalyzingFiles = true;
			analyzingFileNames = attachments.map(a => a.filename);
			assistantMessageId = chatState.startStreaming();
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

					const analysisResults = await analyzeFilesInBatches(filesToAnalyze, model, 3);

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
				console.error('[NewChat] File processing failed:', error);
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

		// Start streaming response (reuse existing message if processing files)
		const hadProcessingMessage = !!assistantMessageId;
		if (!assistantMessageId) {
			assistantMessageId = chatState.startStreaming();
		}

		// Track if we need to clear the "Processing..." text on first token
		let needsClearOnFirstToken = hadProcessingMessage;

		// Start streaming metrics tracking
		streamingMetricsState.startStream();

		// Track tool calls
		let pendingToolCalls: OllamaToolCall[] | null = null;

		try {
			let messages: OllamaMessage[] = [{
				role: 'user',
				content: contentForOllama,
				images
			}];

			// Build system prompt from resolution service + RAG context
			const systemParts: string[] = [];

			// Resolve system prompt using priority chain (model-aware)
			const resolvedPrompt = await resolveSystemPrompt(model, null, null);
			if (resolvedPrompt.content) {
				systemParts.push(resolvedPrompt.content);
			}

			// Add RAG context if available
			const ragContext = await retrieveRagContext(content);
			if (ragContext) {
				systemParts.push(`You have access to a knowledge base. Use the following relevant context to help answer the user's question. If the context isn't relevant, you can ignore it.\n\n${ragContext}`);
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

			const tools = getToolsForApi();

			// Use function model for tool routing if enabled
			const chatModel = (tools && tools.length > 0 && USE_FUNCTION_MODEL)
				? getFunctionModel(model)
				: model;

			// Determine if we should use native thinking mode
			const useNativeThinking = supportsThinking && thinkingEnabled;

			// Track thinking content during streaming
			let streamingThinking = '';
			let thinkingClosed = false;

			// Helper to handle completion (shared by both backends)
			const handleComplete = async () => {
				// Close thinking block if it was opened but not closed
				if (streamingThinking && !thinkingClosed) {
					chatState.appendToStreaming('</think>\n\n');
					thinkingClosed = true;
				}

				chatState.finishStreaming();
				streamingMetricsState.endStream();

				// Handle tool calls if received (Ollama only)
				if (pendingToolCalls && pendingToolCalls.length > 0) {
					await executeToolsAndContinue(
						model,
						assistantMessageId,
						userMessageId,
						pendingToolCalls,
						conversationId
					);
					return;
				}

				// Persist assistant message with the SAME ID as chatState
				const node = chatState.messageTree.get(assistantMessageId);
				if (node) {
					await addStoredMessage(
						conversationId,
						{ role: 'assistant', content: node.message.content },
						userMessageId,
						assistantMessageId
					);
					await updateConversation(conversationId, {});
					conversationsState.update(conversationId, {});

					// Generate a smarter title in the background (don't await)
					generateSmartTitle(conversationId, content, node.message.content);

					// Update URL now that streaming is complete
					replaceState(`/chat/${conversationId}`, {});
				}
			};

			// Helper to handle errors (shared by both backends)
			const handleError = (error: unknown) => {
				console.error('Streaming error:', error);
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				chatState.setStreamContent(`⚠️ Error: ${errorMsg}`);
				chatState.finishStreaming();
				streamingMetricsState.endStream();
			};

			// Use appropriate client based on active backend
			if (backendsState.activeType === 'ollama') {
				// Ollama: full features including tools and thinking
				await ollamaClient.streamChatWithCallbacks(
					{ model: chatModel, messages, tools, think: useNativeThinking, options: settingsState.apiParameters },
					{
						onThinkingToken: (token) => {
							if (needsClearOnFirstToken) {
								chatState.setStreamContent('');
								needsClearOnFirstToken = false;
							}
							if (!streamingThinking) {
								chatState.appendToStreaming('<think>');
							}
							streamingThinking += token;
							chatState.appendToStreaming(token);
							streamingMetricsState.incrementTokens();
						},
						onToken: (token) => {
							if (needsClearOnFirstToken) {
								chatState.setStreamContent('');
								needsClearOnFirstToken = false;
							}
							if (streamingThinking && !thinkingClosed) {
								chatState.appendToStreaming('</think>\n\n');
								thinkingClosed = true;
							}
							chatState.appendToStreaming(token);
							streamingMetricsState.incrementTokens();
						},
						onToolCall: (toolCalls) => {
							pendingToolCalls = toolCalls;
						},
						onComplete: handleComplete,
						onError: handleError
					}
				);
			} else {
				// llama.cpp / LM Studio: use unified API (no tools/thinking support)
				try {
					await unifiedLLMClient.streamChatWithCallbacks(
						{
							model: chatModel,
							messages: messages.map(m => ({ role: m.role, content: m.content })),
							stream: true
						},
						{
							onToken: (token) => {
								if (needsClearOnFirstToken) {
									chatState.setStreamContent('');
									needsClearOnFirstToken = false;
								}
								chatState.appendToStreaming(token);
								streamingMetricsState.incrementTokens();
							},
							onComplete: handleComplete,
							onError: handleError
						}
					);
				} catch (error) {
					handleError(error);
				}
			}
		} catch (error) {
			console.error('Failed to send message:', error);
			// Show error to user
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			chatState.setStreamContent(`⚠️ Error: ${errorMsg}`);
			chatState.finishStreaming();
			streamingMetricsState.endStream();
		}
	}

	/**
	 * Execute tool calls and continue the conversation
	 */
	async function executeToolsAndContinue(
		model: string,
		assistantMessageId: string,
		userMessageId: string,
		toolCalls: OllamaToolCall[],
		conversationId: string
	): Promise<void> {
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

			const assistantNode = chatState.messageTree.get(assistantMessageId);
			if (assistantNode) {
				// Store structured tool call data with results for display
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

			// Persist tool call result (including any thinking content)
			await addStoredMessage(
				conversationId,
				{ role: 'assistant', content: assistantNode?.message.content || '' },
				userMessageId,
				assistantMessageId
			);

			// Add tool results as a hidden message (for model context, not displayed in UI)
			const toolMessageId = chatState.addMessage({
				role: 'user',
				content: `Tool execution results:\n${toolResultContent}\n\nBased on these results, either provide a helpful response OR call another tool if you need more information.`,
				hidden: true
			});

			await addStoredMessage(
				conversationId,
				{ role: 'user', content: `Tool execution results:\n${toolResultContent}` },
				assistantMessageId,
				toolMessageId
			);

			// Stream final response using original model - WITH tools so it can call more if needed
			const finalMessageId = chatState.startStreaming();

			// Continue metrics tracking for tool follow-up
			streamingMetricsState.startStream();

			// Use allMessages (including hidden) to send tool results to the model
			const apiMessages = chatState.allMessages.map(node => ({
				role: node.message.role,
				content: node.message.content,
				images: node.message.images
			})) as OllamaMessage[];

			// Track if model wants to call more tools
			let morePendingToolCalls: OllamaToolCall[] | null = null;

			// Pass tools again so model can chain tool calls
			const tools = getToolsForApi();

			await ollamaClient.streamChatWithCallbacks(
				{ model, messages: apiMessages, tools, options: settingsState.apiParameters },
				{
					onToken: (token) => {
						chatState.appendToStreaming(token);
						streamingMetricsState.incrementTokens();
					},
					onToolCall: (newToolCalls) => {
						morePendingToolCalls = newToolCalls;
					},
					onComplete: async () => {
						chatState.finishStreaming();
						streamingMetricsState.endStream();

						// If model wants to call more tools, recurse
						if (morePendingToolCalls && morePendingToolCalls.length > 0) {
							await executeToolsAndContinue(
								model,
								finalMessageId,
								toolMessageId,
								morePendingToolCalls,
								conversationId
							);
							return;
						}

						const node = chatState.messageTree.get(finalMessageId);
						if (node) {
							await addStoredMessage(
								conversationId,
								{ role: 'assistant', content: node.message.content },
								toolMessageId,
								finalMessageId
							);
							await updateConversation(conversationId, {});
							conversationsState.update(conversationId, {});
						}
					},
					onError: (error) => {
						console.error('Final response error:', error);
						chatState.finishStreaming();
						streamingMetricsState.endStream();
					}
				}
			);
		} catch (error) {
			console.error('Tool execution failed:', error);
			streamingMetricsState.endStream();
		}
	}

	/**
	 * Generate a title from the first message content
	 * Takes the first ~50 characters or first sentence
	 */
	function generateTitle(content: string): string {
		const firstLine = content.split('\n')[0].trim();
		const firstSentence = firstLine.split(/[.!?]/)[0].trim();

		if (firstSentence.length <= 50) {
			return firstSentence || 'New Chat';
		}

		return firstSentence.substring(0, 47) + '...';
	}

	/**
	 * Generate a better title using the LLM after the first response
	 * Runs in the background, doesn't block the UI
	 */
	async function generateSmartTitle(
		conversationId: string,
		userMessage: string,
		assistantMessage: string
	): Promise<void> {
		try {
			// Use a small, fast model for title generation if available, otherwise use selected
			const model = modelsState.selectedId;
			if (!model) {
				return;
			}

			// Strip thinking blocks from assistant message for cleaner title generation
			const cleanedAssistant = assistantMessage
				.replace(/<think>[\s\S]*?<\/think>/g, '')
				.replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
				.trim();

			// Build prompt - use assistant content if available, otherwise just user message
			const promptContent = cleanedAssistant.length > 0
				? `User: ${userMessage.substring(0, 200)}\n\nAssistant: ${cleanedAssistant.substring(0, 300)}`
				: `User message: ${userMessage.substring(0, 400)}`;

			const response = await ollamaClient.chat({
				model,
				messages: [
					{
						role: 'system',
						content: 'Generate a very short, concise title (3-6 words max) for this conversation. Output ONLY the title, no quotes, no explanation, no thinking.'
					},
					{
						role: 'user',
						content: promptContent
					}
				]
			});

			// Strip any thinking blocks from the title response and clean it up
			const newTitle = response.message.content
				.replace(/<think>[\s\S]*?<\/think>/g, '')
				.replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
				.trim()
				.replace(/^["']|["']$/g, '') // Remove quotes
				.replace(/^Title:\s*/i, '') // Remove "Title:" prefix if present
				.substring(0, 50);

			if (newTitle && newTitle.length > 0) {
				await updateConversation(conversationId, { title: newTitle });
				conversationsState.update(conversationId, { title: newTitle });
				currentTitle = newTitle;
			}
		} catch (error) {
			console.error('[NewChat] Failed to generate smart title:', error);
			// Silently fail - keep the original title
		}
	}

	// Track current chat title for browser tab
	let currentTitle = $state<string | null>(null);
</script>

<svelte:head>
	<title>{currentTitle ? `${currentTitle} - Vessel` : 'Vessel'}</title>
</svelte:head>

<div class="flex h-full flex-col">
	<ChatWindow mode="new" onFirstMessage={handleFirstMessage} bind:thinkingEnabled />
</div>
