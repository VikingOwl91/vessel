<script lang="ts">
	/**
	 * Home/new chat page
	 * Shows ChatWindow in "new chat" mode with welcome state
	 * When first message sent, creates conversation and continues streaming here
	 */

	import { onMount } from 'svelte';
	import { chatState, conversationsState, modelsState, toolsState, promptsState } from '$lib/stores';
	import { createConversation as createStoredConversation, addMessage as addStoredMessage, updateConversation } from '$lib/storage';
	import { ollamaClient } from '$lib/ollama';
	import type { OllamaMessage, OllamaToolDefinition, OllamaToolCall } from '$lib/ollama';
	import { getFunctionModel, USE_FUNCTION_MODEL, runToolCalls, formatToolResultsForChat } from '$lib/tools';
	import { searchSimilar, formatResultsAsContext, getKnowledgeBaseStats } from '$lib/memory';
	import ChatWindow from '$lib/components/chat/ChatWindow.svelte';
	import type { Conversation } from '$lib/types/conversation';

	// RAG state
	let ragEnabled = $state(true);
	let hasKnowledgeBase = $state(false);

	// Thinking mode state (for reasoning models)
	let thinkingEnabled = $state(true);

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
			const results = await searchSimilar(query, 3, 0.5);
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
	async function handleFirstMessage(content: string, images?: string[]): Promise<void> {
		const model = modelsState.selectedId;
		if (!model) {
			console.error('No model selected');
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

		// Add to conversations list
		conversationsState.add(conversation);

		// Set up chat state for the new conversation
		chatState.conversationId = conversationId;

		// Add user message to tree
		const userMessageId = chatState.addMessage({
			role: 'user',
			content,
			images
		});

		// Persist user message to IndexedDB with the SAME ID as chatState
		await addStoredMessage(conversationId, { role: 'user', content, images }, null, userMessageId);

		// Update URL without navigation (keeps ChatWindow mounted)
		history.replaceState({}, '', `/chat/${conversationId}`);

		// Start streaming response
		const assistantMessageId = chatState.startStreaming();

		// Track tool calls
		let pendingToolCalls: OllamaToolCall[] | null = null;

		try {
			let messages: OllamaMessage[] = [{
				role: 'user',
				content,
				images
			}];

			// Build system prompt from active prompt + RAG context
			const systemParts: string[] = [];

			// Wait for prompts to be loaded, then add system prompt if active
			await promptsState.ready();
			const activePrompt = promptsState.activePrompt;
			console.log('[NewChat] Prompts state:', {
				promptsCount: promptsState.prompts.length,
				activePromptId: promptsState.activePromptId,
				activePrompt: activePrompt?.name ?? 'none'
			});
			if (activePrompt) {
				systemParts.push(activePrompt.content);
				console.log('[NewChat] Using system prompt:', activePrompt.name);
			}

			// Log thinking mode status (now using native API support, not prompt-based)
			console.log('[NewChat] Thinking mode check:', {
				supportsThinking,
				thinkingEnabled,
				selectedModel: modelsState.selectedId,
				selectedCapabilities: modelsState.selectedCapabilities
			});
			// Note: Thinking is now handled via the `think: true` API parameter instead of prompt injection

			// Add RAG context if available
			const ragContext = await retrieveRagContext(content);
			if (ragContext) {
				systemParts.push(`You have access to a knowledge base. Use the following relevant context to help answer the user's question. If the context isn't relevant, you can ignore it.\n\n${ragContext}`);
				console.log('[NewChat] RAG context injected');
			}

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

			console.log('[NewChat] Tools enabled:', toolsState.toolsEnabled);
			console.log('[NewChat] Tools count:', tools?.length ?? 0);
			console.log('[NewChat] Tool names:', tools?.map(t => t.function.name) ?? []);
			console.log('[NewChat] Using model:', chatModel, '(original:', model, ')');

			// Determine if we should use native thinking mode
			const useNativeThinking = supportsThinking && thinkingEnabled;
			console.log('[NewChat] Native thinking mode:', useNativeThinking);

			// Track thinking content during streaming
			let streamingThinking = '';
			let thinkingClosed = false;

			await ollamaClient.streamChatWithCallbacks(
				{ model: chatModel, messages, tools, think: useNativeThinking },
				{
					onThinkingToken: (token) => {
						// Accumulate thinking and update the message
						if (!streamingThinking) {
							// Start the thinking block
							chatState.appendToStreaming('<think>');
						}
						streamingThinking += token;
						chatState.appendToStreaming(token);
					},
					onToken: (token) => {
						// Close thinking block when content starts
						if (streamingThinking && !thinkingClosed) {
							chatState.appendToStreaming('</think>\n\n');
							thinkingClosed = true;
						}
						chatState.appendToStreaming(token);
					},
					onToolCall: (toolCalls) => {
						pendingToolCalls = toolCalls;
						console.log('[NewChat] Tool calls received:', toolCalls);
					},
					onComplete: async () => {
						// Close thinking block if it was opened but not closed (e.g., tool calls without content)
						if (streamingThinking && !thinkingClosed) {
							chatState.appendToStreaming('</think>\n\n');
							thinkingClosed = true;
						}

						chatState.finishStreaming();

						// Handle tool calls if received
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
						}
					},
					onError: (error) => {
						console.error('Streaming error:', error);
						chatState.finishStreaming();
					}
				}
			);
		} catch (error) {
			console.error('Failed to send message:', error);
			chatState.finishStreaming();
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
			// Convert tool calls to executor format
			const convertedCalls = toolCalls.map(tc => ({
				id: crypto.randomUUID(),
				name: tc.function.name,
				arguments: tc.function.arguments
			}));

			// Execute all tools (including custom tools)
			const results = await runToolCalls(convertedCalls, undefined, toolsState.customTools);

			// Format results for chat
			const toolResultContent = formatToolResultsForChat(results);

			// Update assistant message with tool info
			const toolCallInfo = toolCalls
				.map(tc => `Called tool: ${tc.function.name}(${JSON.stringify(tc.function.arguments)})`)
				.join('\n');

			const assistantNode = chatState.messageTree.get(assistantMessageId);
			if (assistantNode) {
				// Preserve any thinking content that was already streamed
				const existingContent = assistantNode.message.content || '';
				const newContent = toolCallInfo + '\n\n' + toolResultContent;

				// If there's existing content (like thinking), append tool info after it
				if (existingContent.trim()) {
					assistantNode.message.content = existingContent + '\n\n' + newContent;
				} else {
					assistantNode.message.content = newContent;
				}

				// Store structured tool call data for display
				assistantNode.message.toolCalls = toolCalls.map(tc => ({
					id: crypto.randomUUID(),
					name: tc.function.name,
					arguments: JSON.stringify(tc.function.arguments)
				}));
			}

			// Persist tool call result (including any thinking content)
			await addStoredMessage(
				conversationId,
				{ role: 'assistant', content: assistantNode?.message.content || '' },
				userMessageId,
				assistantMessageId
			);

			// Add tool results as a message
			const toolMessageId = chatState.addMessage({
				role: 'user',
				content: `Tool execution results:\n${toolResultContent}\n\nBased on these results, either provide a helpful response OR call another tool if you need more information.`
			});

			await addStoredMessage(
				conversationId,
				{ role: 'user', content: `Tool execution results:\n${toolResultContent}` },
				assistantMessageId,
				toolMessageId
			);

			// Stream final response using original model - WITH tools so it can call more if needed
			const finalMessageId = chatState.startStreaming();

			const allMessages = chatState.visibleMessages.map(node => ({
				role: node.message.role,
				content: node.message.content,
				images: node.message.images
			})) as OllamaMessage[];

			// Track if model wants to call more tools
			let morePendingToolCalls: OllamaToolCall[] | null = null;

			// Pass tools again so model can chain tool calls
			const tools = getToolsForApi();

			await ollamaClient.streamChatWithCallbacks(
				{ model, messages: allMessages, tools },
				{
					onToken: (token) => {
						chatState.appendToStreaming(token);
					},
					onToolCall: (newToolCalls) => {
						morePendingToolCalls = newToolCalls;
						console.log('[NewChat] Additional tool calls received:', newToolCalls);
					},
					onComplete: async () => {
						chatState.finishStreaming();

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
					}
				}
			);
		} catch (error) {
			console.error('Tool execution failed:', error);
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
			if (!model) return;

			// Strip thinking blocks from assistant message for cleaner title generation
			const cleanedAssistant = assistantMessage
				.replace(/<think>[\s\S]*?<\/think>/g, '')
				.replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
				.trim();

			const response = await ollamaClient.chat({
				model,
				messages: [
					{
						role: 'system',
						content: 'Generate a very short, concise title (3-6 words max) for this conversation. Output ONLY the title, no quotes, no explanation.'
					},
					{
						role: 'user',
						content: `User: ${userMessage.substring(0, 200)}\n\nAssistant: ${cleanedAssistant.substring(0, 300)}`
					}
				]
			});

			const newTitle = response.message.content
				.trim()
				.replace(/^["']|["']$/g, '') // Remove quotes
				.substring(0, 50);

			if (newTitle && newTitle.length > 0) {
				await updateConversation(conversationId, { title: newTitle });
				conversationsState.update(conversationId, { title: newTitle });
				console.log('[NewChat] Updated title to:', newTitle);
			}
		} catch (error) {
			console.error('[NewChat] Failed to generate smart title:', error);
			// Silently fail - keep the original title
		}
	}
</script>

<div class="flex h-full flex-col">
	<ChatWindow mode="new" onFirstMessage={handleFirstMessage} bind:thinkingEnabled />
</div>
