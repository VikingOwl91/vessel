/**
 * Built-in tools tests
 *
 * Tests the MathParser and tool definitions
 */

import { describe, it, expect } from 'vitest';
import { builtinTools, getBuiltinToolDefinitions } from './builtin';

// We need to test the MathParser through the calculate handler
// since MathParser is not exported directly
function calculate(expression: string, precision?: number): unknown {
	const entry = builtinTools.get('calculate');
	if (!entry) throw new Error('Calculate tool not found');
	return entry.handler({ expression, precision });
}

describe('MathParser (via calculate tool)', () => {
	describe('basic arithmetic', () => {
		it('handles addition', () => {
			expect(calculate('2+3')).toBe(5);
			expect(calculate('100+200')).toBe(300);
			expect(calculate('1+2+3+4')).toBe(10);
		});

		it('handles subtraction', () => {
			expect(calculate('10-3')).toBe(7);
			expect(calculate('100-50-25')).toBe(25);
		});

		it('handles multiplication', () => {
			expect(calculate('3*4')).toBe(12);
			expect(calculate('2*3*4')).toBe(24);
		});

		it('handles division', () => {
			expect(calculate('10/2')).toBe(5);
			expect(calculate('100/4/5')).toBe(5);
		});

		it('handles modulo', () => {
			expect(calculate('10%3')).toBe(1);
			expect(calculate('17%5')).toBe(2);
		});

		it('handles mixed operations with precedence', () => {
			expect(calculate('2+3*4')).toBe(14);
			expect(calculate('10-2*3')).toBe(4);
			expect(calculate('10/2+3')).toBe(8);
		});
	});

	describe('parentheses', () => {
		it('handles simple parentheses', () => {
			expect(calculate('(2+3)*4')).toBe(20);
			expect(calculate('(10-2)*3')).toBe(24);
		});

		it('handles nested parentheses', () => {
			expect(calculate('((2+3)*4)+1')).toBe(21);
			expect(calculate('2*((3+4)*2)')).toBe(28);
		});
	});

	describe('power/exponentiation', () => {
		it('handles caret operator', () => {
			expect(calculate('2^3')).toBe(8);
			expect(calculate('3^2')).toBe(9);
			expect(calculate('10^0')).toBe(1);
		});

		it('handles double star operator', () => {
			expect(calculate('2**3')).toBe(8);
			expect(calculate('5**2')).toBe(25);
		});

		it('handles right associativity', () => {
			// 2^3^2 should be 2^(3^2) = 2^9 = 512
			expect(calculate('2^3^2')).toBe(512);
		});
	});

	describe('unary operators', () => {
		it('handles negative numbers', () => {
			expect(calculate('-5')).toBe(-5);
			expect(calculate('-5+3')).toBe(-2);
			expect(calculate('3+-5')).toBe(-2);
		});

		it('handles positive prefix', () => {
			expect(calculate('+5')).toBe(5);
			expect(calculate('3++5')).toBe(8);
		});

		it('handles double negation', () => {
			expect(calculate('--5')).toBe(5);
		});
	});

	describe('mathematical functions', () => {
		it('handles sqrt', () => {
			expect(calculate('sqrt(16)')).toBe(4);
			expect(calculate('sqrt(2)')).toBeCloseTo(1.41421356, 5);
		});

		it('handles abs', () => {
			expect(calculate('abs(-5)')).toBe(5);
			expect(calculate('abs(5)')).toBe(5);
		});

		it('handles sign', () => {
			expect(calculate('sign(-10)')).toBe(-1);
			expect(calculate('sign(10)')).toBe(1);
			expect(calculate('sign(0)')).toBe(0);
		});

		it('handles trigonometric functions', () => {
			expect(calculate('sin(0)')).toBe(0);
			expect(calculate('cos(0)')).toBe(1);
			expect(calculate('tan(0)')).toBe(0);
		});

		it('handles inverse trig functions', () => {
			expect(calculate('asin(0)')).toBe(0);
			expect(calculate('acos(1)')).toBe(0);
			expect(calculate('atan(0)')).toBe(0);
		});

		it('handles hyperbolic functions', () => {
			expect(calculate('sinh(0)')).toBe(0);
			expect(calculate('cosh(0)')).toBe(1);
			expect(calculate('tanh(0)')).toBe(0);
		});

		it('handles logarithms', () => {
			expect(calculate('log(1)')).toBe(0);
			expect(calculate('log10(100)')).toBe(2);
			expect(calculate('log2(8)')).toBe(3);
		});

		it('handles exp', () => {
			expect(calculate('exp(0)')).toBe(1);
			expect(calculate('exp(1)')).toBeCloseTo(Math.E, 5);
		});

		it('handles rounding functions', () => {
			expect(calculate('round(1.5)')).toBe(2);
			expect(calculate('floor(1.9)')).toBe(1);
			expect(calculate('ceil(1.1)')).toBe(2);
			expect(calculate('trunc(-1.9)')).toBe(-1);
		});
	});

	describe('constants', () => {
		it('handles PI', () => {
			expect(calculate('PI')).toBeCloseTo(Math.PI, 5);
			expect(calculate('pi')).toBeCloseTo(Math.PI, 5);
		});

		it('handles E', () => {
			expect(calculate('E')).toBeCloseTo(Math.E, 5);
			expect(calculate('e')).toBeCloseTo(Math.E, 5);
		});

		it('handles TAU', () => {
			expect(calculate('TAU')).toBeCloseTo(Math.PI * 2, 5);
			expect(calculate('tau')).toBeCloseTo(Math.PI * 2, 5);
		});

		it('handles PHI (golden ratio)', () => {
			expect(calculate('PHI')).toBeCloseTo(1.618033988, 5);
		});

		it('handles LN2 and LN10', () => {
			expect(calculate('LN2')).toBeCloseTo(Math.LN2, 5);
			expect(calculate('LN10')).toBeCloseTo(Math.LN10, 5);
		});
	});

	describe('complex expressions', () => {
		it('handles PI-based calculations', () => {
			expect(calculate('sin(PI/2)')).toBeCloseTo(1, 5);
			expect(calculate('cos(PI)')).toBeCloseTo(-1, 5);
		});

		it('handles nested functions', () => {
			expect(calculate('sqrt(abs(-16))')).toBe(4);
			expect(calculate('log2(2^10)')).toBe(10);
		});

		it('handles function with complex argument', () => {
			expect(calculate('sqrt(3^2+4^2)')).toBe(5); // Pythagorean: 3-4-5 triangle
		});
	});

	describe('precision handling', () => {
		it('defaults to 10 decimal places', () => {
			const result = calculate('1/3');
			expect(result).toBeCloseTo(0.3333333333, 9);
		});

		it('respects custom precision', () => {
			const result = calculate('1/3', 2);
			expect(result).toBe(0.33);
		});
	});

	describe('error handling', () => {
		it('handles division by zero', () => {
			const result = calculate('1/0') as { error: string };
			expect(result.error).toContain('Division by zero');
		});

		it('handles unknown functions', () => {
			const result = calculate('unknown(5)') as { error: string };
			expect(result.error).toContain('Unknown function');
		});

		it('handles missing closing parenthesis', () => {
			const result = calculate('(2+3') as { error: string };
			expect(result.error).toContain('parenthesis');
		});

		it('handles unexpected characters', () => {
			const result = calculate('2+@3') as { error: string };
			expect(result.error).toContain('Unexpected character');
		});

		it('handles infinity result', () => {
			const result = calculate('exp(1000)') as { error: string };
			expect(result.error).toContain('invalid number');
		});
	});

	describe('whitespace handling', () => {
		it('ignores whitespace', () => {
			expect(calculate('2 + 3')).toBe(5);
			expect(calculate(' 2 * 3 ')).toBe(6);
			expect(calculate('sqrt( 16 )')).toBe(4);
		});
	});
});

describe('builtinTools registry', () => {
	it('contains all expected tools', () => {
		expect(builtinTools.has('get_current_time')).toBe(true);
		expect(builtinTools.has('calculate')).toBe(true);
		expect(builtinTools.has('fetch_url')).toBe(true);
		expect(builtinTools.has('get_location')).toBe(true);
		expect(builtinTools.has('web_search')).toBe(true);
	});

	it('marks all tools as builtin', () => {
		for (const [, entry] of builtinTools) {
			expect(entry.isBuiltin).toBe(true);
		}
	});

	it('has valid definitions for all tools', () => {
		for (const [name, entry] of builtinTools) {
			expect(entry.definition.type).toBe('function');
			expect(entry.definition.function.name).toBe(name);
			expect(typeof entry.definition.function.description).toBe('string');
		}
	});
});

describe('getBuiltinToolDefinitions', () => {
	it('returns array of tool definitions', () => {
		const definitions = getBuiltinToolDefinitions();
		expect(Array.isArray(definitions)).toBe(true);
		expect(definitions.length).toBe(5);
	});

	it('returns valid definitions', () => {
		const definitions = getBuiltinToolDefinitions();
		for (const def of definitions) {
			expect(def.type).toBe('function');
			expect(def.function).toBeDefined();
			expect(typeof def.function.name).toBe('string');
		}
	});
});
