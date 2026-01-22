/**
 * Model limits tests
 *
 * Tests model context window detection and capability checks
 */

import { describe, it, expect } from 'vitest';
import {
	getModelContextLimit,
	modelSupportsTools,
	modelSupportsVision,
	formatContextSize
} from './model-limits';

describe('getModelContextLimit', () => {
	describe('Llama models', () => {
		it('returns 128K for llama 3.2', () => {
			expect(getModelContextLimit('llama3.2:8b')).toBe(128000);
			expect(getModelContextLimit('llama-3.2:70b')).toBe(128000);
		});

		it('returns 128K for llama 3.1', () => {
			expect(getModelContextLimit('llama3.1:8b')).toBe(128000);
			expect(getModelContextLimit('llama-3.1:405b')).toBe(128000);
		});

		it('returns 8K for llama 3 base', () => {
			expect(getModelContextLimit('llama3:8b')).toBe(8192);
			expect(getModelContextLimit('llama-3:70b')).toBe(8192);
		});

		it('returns 4K for llama 2', () => {
			expect(getModelContextLimit('llama2:7b')).toBe(4096);
			expect(getModelContextLimit('llama-2:13b')).toBe(4096);
		});
	});

	describe('Mistral models', () => {
		it('returns 128K for mistral-large', () => {
			expect(getModelContextLimit('mistral-large:latest')).toBe(128000);
		});

		it('returns 128K for mistral nemo', () => {
			expect(getModelContextLimit('mistral-nemo:12b')).toBe(128000);
		});

		it('returns 32K for base mistral', () => {
			expect(getModelContextLimit('mistral:7b')).toBe(32000);
			expect(getModelContextLimit('mistral:latest')).toBe(32000);
		});

		it('returns 32K for mixtral', () => {
			expect(getModelContextLimit('mixtral:8x7b')).toBe(32000);
		});
	});

	describe('Qwen models', () => {
		it('returns 128K for qwen 2.5', () => {
			expect(getModelContextLimit('qwen2.5:7b')).toBe(128000);
		});

		it('returns 32K for qwen 2', () => {
			expect(getModelContextLimit('qwen2:7b')).toBe(32000);
		});

		it('returns 8K for older qwen', () => {
			expect(getModelContextLimit('qwen:14b')).toBe(8192);
		});
	});

	describe('Other models', () => {
		it('returns 128K for phi-3', () => {
			expect(getModelContextLimit('phi-3:mini')).toBe(128000);
		});

		it('returns 16K for codellama', () => {
			expect(getModelContextLimit('codellama:34b')).toBe(16384);
		});

		it('returns 200K for yi models', () => {
			expect(getModelContextLimit('yi:34b')).toBe(200000);
		});

		it('returns 4K for llava vision models', () => {
			expect(getModelContextLimit('llava:7b')).toBe(4096);
		});
	});

	describe('Default fallback', () => {
		it('returns 4K for unknown models', () => {
			expect(getModelContextLimit('unknown-model:latest')).toBe(4096);
			expect(getModelContextLimit('custom-finetune')).toBe(4096);
		});
	});

	it('is case insensitive', () => {
		expect(getModelContextLimit('LLAMA3.1:8B')).toBe(128000);
		expect(getModelContextLimit('Mistral:Latest')).toBe(32000);
	});
});

describe('modelSupportsTools', () => {
	it('returns true for llama 3.1+', () => {
		expect(modelSupportsTools('llama3.1:8b')).toBe(true);
		expect(modelSupportsTools('llama3.2:3b')).toBe(true);
		expect(modelSupportsTools('llama-3.1:70b')).toBe(true);
	});

	it('returns true for mistral with tool support', () => {
		expect(modelSupportsTools('mistral:7b')).toBe(true);
		expect(modelSupportsTools('mistral-large:latest')).toBe(true);
		expect(modelSupportsTools('mistral-nemo:12b')).toBe(true);
	});

	it('returns true for mixtral', () => {
		expect(modelSupportsTools('mixtral:8x7b')).toBe(true);
	});

	it('returns true for qwen2', () => {
		expect(modelSupportsTools('qwen2:7b')).toBe(true);
		expect(modelSupportsTools('qwen2.5:14b')).toBe(true);
	});

	it('returns true for command-r', () => {
		expect(modelSupportsTools('command-r:latest')).toBe(true);
	});

	it('returns true for deepseek', () => {
		expect(modelSupportsTools('deepseek-coder:6.7b')).toBe(true);
	});

	it('returns false for llama 3 base (no tools)', () => {
		expect(modelSupportsTools('llama3:8b')).toBe(false);
	});

	it('returns false for older models', () => {
		expect(modelSupportsTools('llama2:7b')).toBe(false);
		expect(modelSupportsTools('vicuna:13b')).toBe(false);
	});
});

describe('modelSupportsVision', () => {
	it('returns true for llava models', () => {
		expect(modelSupportsVision('llava:7b')).toBe(true);
		expect(modelSupportsVision('llava:13b')).toBe(true);
	});

	it('returns true for bakllava', () => {
		expect(modelSupportsVision('bakllava:7b')).toBe(true);
	});

	it('returns true for llama 3.2 vision', () => {
		expect(modelSupportsVision('llama3.2-vision:11b')).toBe(true);
	});

	it('returns true for moondream', () => {
		expect(modelSupportsVision('moondream:1.8b')).toBe(true);
	});

	it('returns false for text-only models', () => {
		expect(modelSupportsVision('llama3:8b')).toBe(false);
		expect(modelSupportsVision('mistral:7b')).toBe(false);
		expect(modelSupportsVision('codellama:34b')).toBe(false);
	});
});

describe('formatContextSize', () => {
	it('formats large numbers with K suffix', () => {
		expect(formatContextSize(128000)).toBe('128K');
		expect(formatContextSize(100000)).toBe('100K');
	});

	it('formats medium numbers with K suffix', () => {
		expect(formatContextSize(32000)).toBe('32K');
		expect(formatContextSize(8192)).toBe('8K');
		expect(formatContextSize(4096)).toBe('4K');
	});

	it('formats small numbers without suffix', () => {
		expect(formatContextSize(512)).toBe('512');
		expect(formatContextSize(100)).toBe('100');
	});

	it('rounds large numbers', () => {
		expect(formatContextSize(128000)).toBe('128K');
	});
});
