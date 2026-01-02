<script lang="ts">
	/**
	 * ToolEditor - Modal for creating and editing custom tools
	 */

	import { toolsState } from '$lib/stores';
	import type { CustomTool, JSONSchema, JSONSchemaProperty, ToolImplementation } from '$lib/tools';
	import { getTemplatesByLanguage, type ToolTemplate } from '$lib/tools';
	import CodeEditor from './CodeEditor.svelte';
	import ToolDocs from './ToolDocs.svelte';
	import ToolTester from './ToolTester.svelte';

	interface Props {
		isOpen: boolean;
		editingTool?: CustomTool | null;
		onClose: () => void;
		onSave: (tool: CustomTool) => void;
	}

	const { isOpen, editingTool = null, onClose, onSave }: Props = $props();

	// Default code templates
	const defaultJsCode = `// Arguments are available as \`args\` object
// Return the result
return { message: "Hello from custom tool!" };`;

	const defaultPythonCode = `# Arguments available as \`args\` dict
# Print JSON result to stdout
import json

result = {"message": f"Hello, {args.get('name', 'World')}!"}
print(json.dumps(result))`;

	// Form state
	let name = $state('');
	let description = $state('');
	let implementation = $state<ToolImplementation>('javascript');
	let code = $state(defaultJsCode);
	let endpoint = $state('');
	let httpMethod = $state<'GET' | 'POST'>('POST');
	let enabled = $state(true);

	// Track previous implementation for code switching
	let prevImplementation = $state<ToolImplementation>('javascript');

	// Parameters state (simplified - array of parameter definitions)
	let parameters = $state<Array<{ name: string; type: string; description: string; required: boolean }>>([]);

	// Validation
	let errors = $state<Record<string, string>>({});

	// UI state
	let showDocs = $state(false);
	let showTemplates = $state(false);
	let showTest = $state(false);

	// Get templates for current language
	const currentTemplates = $derived(
		implementation === 'javascript' || implementation === 'python'
			? getTemplatesByLanguage(implementation)
			: []
	);

	function applyTemplate(template: ToolTemplate): void {
		name = template.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
		description = template.description;
		code = template.code;
		// Convert parameters from template
		parameters = Object.entries(template.parameters.properties ?? {}).map(([paramName, prop]) => ({
			name: paramName,
			type: prop.type,
			description: prop.description ?? '',
			required: template.parameters.required?.includes(paramName) ?? false
		}));
		showTemplates = false;
	}

	// Reset form when modal opens or editing tool changes
	$effect(() => {
		if (isOpen) {
			if (editingTool) {
				name = editingTool.name;
				description = editingTool.description;
				implementation = editingTool.implementation;
				code = editingTool.code ?? '';
				endpoint = editingTool.endpoint ?? '';
				httpMethod = editingTool.httpMethod ?? 'POST';
				enabled = editingTool.enabled;
				// Convert parameters from JSON schema to array format
				parameters = Object.entries(editingTool.parameters.properties ?? {}).map(([paramName, prop]) => ({
					name: paramName,
					type: prop.type,
					description: prop.description ?? '',
					required: editingTool.parameters.required?.includes(paramName) ?? false
				}));
			} else {
				resetForm();
			}
			errors = {};
		}
	});

	function resetForm(): void {
		name = '';
		description = '';
		implementation = 'javascript';
		prevImplementation = 'javascript';
		code = defaultJsCode;
		endpoint = '';
		httpMethod = 'POST';
		enabled = true;
		parameters = [];
	}

	// Switch to default code when implementation changes (unless editing)
	$effect(() => {
		if (!editingTool && implementation !== prevImplementation) {
			// Only switch code if it's still the default for the previous type
			const isDefaultJs = code === defaultJsCode || code.trim() === '';
			const isDefaultPy = code === defaultPythonCode;

			if (isDefaultJs || isDefaultPy || code.trim() === '') {
				if (implementation === 'python') {
					code = defaultPythonCode;
				} else if (implementation === 'javascript') {
					code = defaultJsCode;
				}
			}
			prevImplementation = implementation;
		}
	});

	function addParameter(): void {
		parameters = [...parameters, { name: '', type: 'string', description: '', required: false }];
	}

	function removeParameter(index: number): void {
		parameters = parameters.filter((_, i) => i !== index);
	}

	function validate(): boolean {
		const newErrors: Record<string, string> = {};

		if (!name.trim()) {
			newErrors.name = 'Tool name is required';
		} else if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
			newErrors.name = 'Tool name must be alphanumeric with underscores';
		} else {
			// Check for duplicate names (except when editing the same tool)
			const existingTool = toolsState.customTools.find(t => t.name === name && t.id !== editingTool?.id);
			if (existingTool) {
				newErrors.name = 'A tool with this name already exists';
			}
		}

		if (!description.trim()) {
			newErrors.description = 'Description is required';
		}

		if ((implementation === 'javascript' || implementation === 'python') && !code.trim()) {
			newErrors.code = `${implementation === 'javascript' ? 'JavaScript' : 'Python'} code is required`;
		}

		if (implementation === 'http' && !endpoint.trim()) {
			newErrors.endpoint = 'HTTP endpoint is required';
		}

		// Validate parameter names
		parameters.forEach((param, i) => {
			if (param.name && !/^[a-z_][a-z0-9_]*$/i.test(param.name)) {
				newErrors[`param_${i}`] = 'Invalid parameter name';
			}
		});

		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	function buildParameterSchema(): JSONSchema {
		const properties: Record<string, JSONSchemaProperty> = {};
		const required: string[] = [];

		for (const param of parameters) {
			if (param.name.trim()) {
				properties[param.name] = {
					type: param.type as JSONSchemaProperty['type'],
					description: param.description || undefined
				};
				if (param.required) {
					required.push(param.name);
				}
			}
		}

		return {
			type: 'object',
			properties,
			required: required.length > 0 ? required : undefined
		};
	}

	function handleSave(): void {
		if (!validate()) return;

		const tool: CustomTool = {
			id: editingTool?.id ?? crypto.randomUUID(),
			name: name.trim(),
			description: description.trim(),
			parameters: buildParameterSchema(),
			implementation,
			code: (implementation === 'javascript' || implementation === 'python') ? code : undefined,
			endpoint: implementation === 'http' ? endpoint : undefined,
			httpMethod: implementation === 'http' ? httpMethod : undefined,
			enabled,
			createdAt: editingTool?.createdAt ?? new Date(),
			updatedAt: new Date()
		};

		onSave(tool);
		onClose();
	}

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	>
		<div
			class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-theme-secondary shadow-2xl"
			role="dialog"
			aria-modal="true"
		>
			<!-- Header -->
			<div class="sticky top-0 flex items-center justify-between border-b border-theme bg-theme-secondary px-6 py-4">
				<h2 class="text-lg font-semibold text-theme-primary">
					{editingTool ? 'Edit Tool' : 'Create Custom Tool'}
				</h2>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-1.5 text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
					</svg>
				</button>
			</div>

			<!-- Form -->
			<div class="space-y-6 p-6">
				<!-- Name -->
				<div>
					<label for="tool-name" class="block text-sm font-medium text-theme-secondary">Tool Name</label>
					<input
						id="tool-name"
						type="text"
						bind:value={name}
						placeholder="my_custom_tool"
						class="mt-1 w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
					{#if errors.name}
						<p class="mt-1 text-sm text-red-400">{errors.name}</p>
					{/if}
				</div>

				<!-- Description -->
				<div>
					<label for="tool-description" class="block text-sm font-medium text-theme-secondary">Description</label>
					<textarea
						id="tool-description"
						bind:value={description}
						rows="2"
						placeholder="What does this tool do? The AI uses this to decide when to call it."
						class="mt-1 w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					></textarea>
					{#if errors.description}
						<p class="mt-1 text-sm text-red-400">{errors.description}</p>
					{/if}
				</div>

				<!-- Parameters -->
				<div>
					<div class="flex items-center justify-between">
						<label class="block text-sm font-medium text-theme-secondary">Parameters</label>
						<button
							type="button"
							onclick={addParameter}
							class="text-sm text-blue-400 hover:text-blue-300"
						>
							+ Add Parameter
						</button>
					</div>

					{#if parameters.length > 0}
						<div class="mt-2 space-y-3">
							{#each parameters as param, index (index)}
								<div class="flex gap-2 items-start rounded-lg border border-theme-subtle bg-theme-tertiary/50 p-3">
									<div class="flex-1 grid grid-cols-2 gap-2">
										<input
											type="text"
											bind:value={param.name}
											placeholder="param_name"
											class="rounded border border-theme-subtle bg-theme-tertiary px-2 py-1 text-sm text-theme-primary"
										/>
										<select
											bind:value={param.type}
											class="rounded border border-theme-subtle bg-theme-tertiary px-2 py-1 text-sm text-theme-primary"
										>
											<option value="string">string</option>
											<option value="number">number</option>
											<option value="boolean">boolean</option>
											<option value="array">array</option>
										</select>
										<input
											type="text"
											bind:value={param.description}
											placeholder="Description"
											class="col-span-2 rounded border border-theme-subtle bg-theme-tertiary px-2 py-1 text-sm text-theme-primary"
										/>
										<label class="col-span-2 flex items-center gap-2 text-sm text-theme-secondary">
											<input type="checkbox" bind:checked={param.required} class="rounded" />
											Required
										</label>
									</div>
									<button
										type="button"
										onclick={() => removeParameter(index)}
										class="text-theme-muted hover:text-red-400"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
										</svg>
									</button>
								</div>
								{#if errors[`param_${index}`]}
									<p class="text-sm text-red-400">{errors[`param_${index}`]}</p>
								{/if}
							{/each}
						</div>
					{:else}
						<p class="mt-2 text-sm text-theme-muted">No parameters defined. Click "Add Parameter" to define inputs.</p>
					{/if}
				</div>

				<!-- Implementation Type -->
				<div>
					<label class="block text-sm font-medium text-theme-secondary">Implementation</label>
					<div class="mt-2 flex flex-wrap gap-4">
						<label class="flex items-center gap-2 text-theme-secondary">
							<input
								type="radio"
								bind:group={implementation}
								value="javascript"
								class="text-blue-500"
							/>
							JavaScript
						</label>
						<label class="flex items-center gap-2 text-theme-secondary">
							<input
								type="radio"
								bind:group={implementation}
								value="python"
								class="text-blue-500"
							/>
							Python
						</label>
						<label class="flex items-center gap-2 text-theme-secondary">
							<input
								type="radio"
								bind:group={implementation}
								value="http"
								class="text-blue-500"
							/>
							HTTP Endpoint
						</label>
					</div>
				</div>

				<!-- Code Editor (JavaScript or Python) -->
				{#if implementation === 'javascript' || implementation === 'python'}
					<div>
						<div class="flex items-center justify-between mb-1">
							<label class="block text-sm font-medium text-theme-secondary">
								{implementation === 'javascript' ? 'JavaScript' : 'Python'} Code
							</label>
							<div class="flex items-center gap-2">
								<!-- Templates dropdown -->
								<div class="relative">
									<button
										type="button"
										onclick={() => showTemplates = !showTemplates}
										class="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
											<path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
										</svg>
										Templates
									</button>
									{#if showTemplates && currentTemplates.length > 0}
										<div class="absolute right-0 top-full mt-1 w-64 rounded-lg border border-theme-subtle bg-theme-secondary shadow-lg z-10">
											<div class="p-2 space-y-1 max-h-48 overflow-y-auto">
												{#each currentTemplates as template (template.id)}
													<button
														type="button"
														onclick={() => applyTemplate(template)}
														class="w-full text-left px-3 py-2 rounded hover:bg-theme-tertiary"
													>
														<div class="text-sm text-theme-primary">{template.name}</div>
														<div class="text-xs text-theme-muted truncate">{template.description}</div>
													</button>
												{/each}
											</div>
										</div>
									{/if}
								</div>
								<!-- Docs toggle -->
								<button
									type="button"
									onclick={() => showDocs = !showDocs}
									class="flex items-center gap-1 text-xs {showDocs ? 'text-emerald-400' : 'text-theme-muted hover:text-theme-secondary'}"
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
									</svg>
									Docs
								</button>
							</div>
						</div>
						<p class="text-xs text-theme-muted mb-2">
							{#if implementation === 'javascript'}
								Arguments are passed as an <code class="bg-theme-tertiary px-1 rounded">args</code> object. Return the result.
							{:else}
								Arguments are available as <code class="bg-theme-tertiary px-1 rounded">args</code> dict. Print JSON result to stdout.
							{/if}
						</p>

						<!-- Documentation panel -->
						<ToolDocs
							language={implementation}
							isOpen={showDocs}
							onclose={() => showDocs = false}
						/>

						<div class="mt-2">
							<CodeEditor
								bind:value={code}
								language={implementation === 'python' ? 'python' : 'javascript'}
								minHeight="200px"
							/>
						</div>
						{#if errors.code}
							<p class="mt-1 text-sm text-red-400">{errors.code}</p>
						{/if}

						<!-- Test button -->
						<button
							type="button"
							onclick={() => showTest = !showTest}
							class="mt-3 flex items-center gap-2 text-sm {showTest ? 'text-emerald-400' : 'text-theme-muted hover:text-theme-secondary'}"
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
							</svg>
							{showTest ? 'Hide Test Panel' : 'Test Tool'}
						</button>

						<!-- Tool tester -->
						<ToolTester
							{implementation}
							{code}
							parameters={buildParameterSchema()}
							isOpen={showTest}
							onclose={() => showTest = false}
						/>
					</div>
				{/if}

				<!-- HTTP Endpoint -->
				{#if implementation === 'http'}
					<div class="space-y-4">
						<div>
							<label for="tool-endpoint" class="block text-sm font-medium text-theme-secondary">Endpoint URL</label>
							<input
								id="tool-endpoint"
								type="url"
								bind:value={endpoint}
								placeholder="https://api.example.com/tool"
								class="mt-1 w-full rounded-lg border border-theme-subtle bg-theme-tertiary px-3 py-2 text-theme-primary placeholder-theme-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
							{#if errors.endpoint}
								<p class="mt-1 text-sm text-red-400">{errors.endpoint}</p>
							{/if}
						</div>
						<div>
							<label class="block text-sm font-medium text-theme-secondary">HTTP Method</label>
							<div class="mt-2 flex gap-4">
								<label class="flex items-center gap-2 text-theme-secondary">
									<input type="radio" bind:group={httpMethod} value="GET" />
									GET
								</label>
								<label class="flex items-center gap-2 text-theme-secondary">
									<input type="radio" bind:group={httpMethod} value="POST" />
									POST
								</label>
							</div>
						</div>
					</div>
				{/if}

				<!-- Enabled Toggle -->
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-theme-secondary">Enable tool</span>
					<button
						type="button"
						onclick={() => enabled = !enabled}
						class="relative inline-flex h-6 w-11 cursor-pointer rounded-full transition-colors {enabled ? 'bg-blue-600' : 'bg-theme-tertiary'}"
						role="switch"
						aria-checked={enabled}
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition {enabled ? 'translate-x-5' : 'translate-x-0'}"
						></span>
					</button>
				</div>
			</div>

			<!-- Footer -->
			<div class="sticky bottom-0 flex justify-end gap-3 border-t border-theme bg-theme-secondary px-6 py-4">
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg px-4 py-2 text-sm font-medium text-theme-secondary hover:bg-theme-tertiary"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleSave}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
				>
					{editingTool ? 'Save Changes' : 'Create Tool'}
				</button>
			</div>
		</div>
	</div>
{/if}
