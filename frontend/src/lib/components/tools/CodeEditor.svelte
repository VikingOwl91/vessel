<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorView, basicSetup } from 'codemirror';
	import { javascript } from '@codemirror/lang-javascript';
	import { python } from '@codemirror/lang-python';
	import { json } from '@codemirror/lang-json';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { EditorState, Compartment } from '@codemirror/state';

	interface Props {
		value: string;
		language?: 'javascript' | 'python' | 'json';
		readonly?: boolean;
		placeholder?: string;
		minHeight?: string;
		onchange?: (value: string) => void;
	}

	let {
		value = $bindable(''),
		language = 'javascript',
		readonly = false,
		placeholder = '',
		minHeight = '200px',
		onchange
	}: Props = $props();

	let editorContainer: HTMLDivElement;
	let editorView: EditorView | null = null;
	const languageCompartment = new Compartment();
	const readonlyCompartment = new Compartment();

	function getLanguageExtension(lang: string) {
		switch (lang) {
			case 'python':
				return python();
			case 'json':
				return json();
			case 'javascript':
			default:
				return javascript();
		}
	}

	onMount(() => {
		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const newValue = update.state.doc.toString();
				if (newValue !== value) {
					value = newValue;
					onchange?.(newValue);
				}
			}
		});

		const state = EditorState.create({
			doc: value,
			extensions: [
				basicSetup,
				languageCompartment.of(getLanguageExtension(language)),
				readonlyCompartment.of(EditorState.readOnly.of(readonly)),
				oneDark,
				updateListener,
				EditorView.theme({
					'&': { minHeight },
					'.cm-scroller': { overflow: 'auto' },
					'.cm-content': { minHeight },
					'&.cm-focused': { outline: 'none' }
				}),
				placeholder ? EditorView.contentAttributes.of({ 'aria-placeholder': placeholder }) : []
			]
		});

		editorView = new EditorView({
			state,
			parent: editorContainer
		});
	});

	onDestroy(() => {
		editorView?.destroy();
	});

	// Update editor when value changes externally
	$effect(() => {
		if (editorView && editorView.state.doc.toString() !== value) {
			editorView.dispatch({
				changes: {
					from: 0,
					to: editorView.state.doc.length,
					insert: value
				}
			});
		}
	});

	// Update language when it changes
	$effect(() => {
		if (editorView) {
			editorView.dispatch({
				effects: languageCompartment.reconfigure(getLanguageExtension(language))
			});
		}
	});

	// Update readonly when it changes
	$effect(() => {
		if (editorView) {
			editorView.dispatch({
				effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(readonly))
			});
		}
	});
</script>

<div class="code-editor rounded-md overflow-hidden border border-surface-500/30" bind:this={editorContainer}></div>

<style>
	.code-editor :global(.cm-editor) {
		font-size: 14px;
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
	}

	.code-editor :global(.cm-gutters) {
		border-right: 1px solid rgba(255, 255, 255, 0.1);
	}
</style>
