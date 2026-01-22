/**
 * Modelfile parser tests
 *
 * Tests parsing of Ollama Modelfile format directives
 */

import { describe, it, expect } from 'vitest';
import {
	parseSystemPromptFromModelfile,
	parseTemplateFromModelfile,
	parseParametersFromModelfile,
	hasSystemPrompt
} from './modelfile-parser';

describe('parseSystemPromptFromModelfile', () => {
	it('returns null for empty input', () => {
		expect(parseSystemPromptFromModelfile('')).toBeNull();
		expect(parseSystemPromptFromModelfile(null as unknown as string)).toBeNull();
	});

	it('parses triple double quoted system prompt', () => {
		const modelfile = `FROM llama3
SYSTEM """
You are a helpful assistant.
Be concise and clear.
"""
PARAMETER temperature 0.7`;

		const result = parseSystemPromptFromModelfile(modelfile);
		expect(result).toBe('You are a helpful assistant.\nBe concise and clear.');
	});

	it('parses triple single quoted system prompt', () => {
		const modelfile = `FROM llama3
SYSTEM '''
You are a coding assistant.
'''`;

		const result = parseSystemPromptFromModelfile(modelfile);
		expect(result).toBe('You are a coding assistant.');
	});

	it('parses double quoted single-line system prompt', () => {
		const modelfile = `FROM llama3
SYSTEM "You are a helpful assistant."`;

		const result = parseSystemPromptFromModelfile(modelfile);
		expect(result).toBe('You are a helpful assistant.');
	});

	it('parses single quoted single-line system prompt', () => {
		const modelfile = `FROM mistral
SYSTEM 'Be brief and accurate.'`;

		const result = parseSystemPromptFromModelfile(modelfile);
		expect(result).toBe('Be brief and accurate.');
	});

	it('parses unquoted system prompt', () => {
		const modelfile = `FROM llama3
SYSTEM You are a helpful AI`;

		const result = parseSystemPromptFromModelfile(modelfile);
		expect(result).toBe('You are a helpful AI');
	});

	it('returns null when no system directive', () => {
		const modelfile = `FROM llama3
PARAMETER temperature 0.8`;

		expect(parseSystemPromptFromModelfile(modelfile)).toBeNull();
	});

	it('is case insensitive', () => {
		const modelfile = `system "Lower case works too"`;
		expect(parseSystemPromptFromModelfile(modelfile)).toBe('Lower case works too');
	});
});

describe('parseTemplateFromModelfile', () => {
	it('returns null for empty input', () => {
		expect(parseTemplateFromModelfile('')).toBeNull();
	});

	it('parses triple quoted template', () => {
		const modelfile = `FROM llama3
TEMPLATE """{{ .System }}
{{ .Prompt }}"""`;

		const result = parseTemplateFromModelfile(modelfile);
		expect(result).toBe('{{ .System }}\n{{ .Prompt }}');
	});

	it('parses single-line template', () => {
		const modelfile = `FROM mistral
TEMPLATE "{{ .Prompt }}"`;

		const result = parseTemplateFromModelfile(modelfile);
		expect(result).toBe('{{ .Prompt }}');
	});

	it('returns null when no template', () => {
		const modelfile = `FROM llama3
SYSTEM "Hello"`;

		expect(parseTemplateFromModelfile(modelfile)).toBeNull();
	});
});

describe('parseParametersFromModelfile', () => {
	it('returns empty object for empty input', () => {
		expect(parseParametersFromModelfile('')).toEqual({});
	});

	it('parses single parameter', () => {
		const modelfile = `FROM llama3
PARAMETER temperature 0.7`;

		const result = parseParametersFromModelfile(modelfile);
		expect(result).toEqual({ temperature: '0.7' });
	});

	it('parses multiple parameters', () => {
		const modelfile = `FROM llama3
PARAMETER temperature 0.8
PARAMETER top_k 40
PARAMETER top_p 0.9
PARAMETER num_ctx 4096`;

		const result = parseParametersFromModelfile(modelfile);
		expect(result).toEqual({
			temperature: '0.8',
			top_k: '40',
			top_p: '0.9',
			num_ctx: '4096'
		});
	});

	it('normalizes parameter names to lowercase', () => {
		const modelfile = `PARAMETER Temperature 0.5
PARAMETER TOP_K 50`;

		const result = parseParametersFromModelfile(modelfile);
		expect(result.temperature).toBe('0.5');
		expect(result.top_k).toBe('50');
	});

	it('handles mixed content', () => {
		const modelfile = `FROM mistral
SYSTEM "Be helpful"
PARAMETER temperature 0.7
TEMPLATE "{{ .Prompt }}"
PARAMETER num_ctx 8192`;

		const result = parseParametersFromModelfile(modelfile);
		expect(result).toEqual({
			temperature: '0.7',
			num_ctx: '8192'
		});
	});
});

describe('hasSystemPrompt', () => {
	it('returns true when system prompt exists', () => {
		expect(hasSystemPrompt('SYSTEM "Hello"')).toBe(true);
		expect(hasSystemPrompt('SYSTEM """Multi\nline"""')).toBe(true);
	});

	it('returns false when no system prompt', () => {
		expect(hasSystemPrompt('FROM llama3')).toBe(false);
		expect(hasSystemPrompt('')).toBe(false);
	});
});
