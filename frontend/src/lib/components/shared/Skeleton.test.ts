/**
 * Skeleton component tests
 *
 * Tests the loading placeholder component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Skeleton from './Skeleton.svelte';

describe('Skeleton', () => {
	it('renders with default props', () => {
		render(Skeleton);
		const skeleton = screen.getByRole('status');
		expect(skeleton).toBeDefined();
		expect(skeleton.getAttribute('aria-label')).toBe('Loading...');
	});

	it('renders with custom width and height', () => {
		render(Skeleton, { props: { width: '200px', height: '50px' } });
		const skeleton = screen.getByRole('status');
		expect(skeleton.style.width).toBe('200px');
		expect(skeleton.style.height).toBe('50px');
	});

	it('renders circular variant', () => {
		render(Skeleton, { props: { variant: 'circular' } });
		const skeleton = screen.getByRole('status');
		expect(skeleton.className).toContain('rounded-full');
	});

	it('renders rectangular variant', () => {
		render(Skeleton, { props: { variant: 'rectangular' } });
		const skeleton = screen.getByRole('status');
		expect(skeleton.className).toContain('rounded-none');
	});

	it('renders rounded variant', () => {
		render(Skeleton, { props: { variant: 'rounded' } });
		const skeleton = screen.getByRole('status');
		expect(skeleton.className).toContain('rounded-lg');
	});

	it('renders text variant by default', () => {
		render(Skeleton, { props: { variant: 'text' } });
		const skeleton = screen.getByRole('status');
		expect(skeleton.className).toContain('rounded');
	});

	it('renders multiple lines for text variant', () => {
		render(Skeleton, { props: { variant: 'text', lines: 3 } });
		const skeletons = screen.getAllByRole('status');
		expect(skeletons).toHaveLength(3);
	});

	it('applies custom class', () => {
		render(Skeleton, { props: { class: 'my-custom-class' } });
		const skeleton = screen.getByRole('status');
		expect(skeleton.className).toContain('my-custom-class');
	});

	it('has animate-pulse class for loading effect', () => {
		render(Skeleton);
		const skeleton = screen.getByRole('status');
		expect(skeleton.className).toContain('animate-pulse');
	});
});
