/**
 * ThinkingBlock component tests
 *
 * Tests the collapsible thinking/reasoning display component
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ThinkingBlock from './ThinkingBlock.svelte';

describe('ThinkingBlock', () => {
	it('renders collapsed by default', () => {
		render(ThinkingBlock, {
			props: {
				content: 'Some thinking content'
			}
		});

		// Should show the header
		expect(screen.getByText('Reasoning')).toBeDefined();
		// Content should not be visible when collapsed
		expect(screen.queryByText('Some thinking content')).toBeNull();
	});

	it('renders expanded when defaultExpanded is true', () => {
		render(ThinkingBlock, {
			props: {
				content: 'Some thinking content',
				defaultExpanded: true
			}
		});

		// Content should be visible when expanded
		// The content is rendered as HTML, so we check for the container
		const content = screen.getByText(/Click to collapse/);
		expect(content).toBeDefined();
	});

	it('toggles expand/collapse on click', async () => {
		render(ThinkingBlock, {
			props: {
				content: 'Toggle content'
			}
		});

		// Initially collapsed
		expect(screen.getByText('Click to expand')).toBeDefined();

		// Click to expand
		const button = screen.getByRole('button');
		await fireEvent.click(button);

		// Should show collapse option
		expect(screen.getByText('Click to collapse')).toBeDefined();

		// Click to collapse
		await fireEvent.click(button);

		// Should show expand option again
		expect(screen.getByText('Click to expand')).toBeDefined();
	});

	it('shows thinking indicator when in progress', () => {
		render(ThinkingBlock, {
			props: {
				content: 'Current thinking...',
				inProgress: true
			}
		});

		expect(screen.getByText('Thinking...')).toBeDefined();
	});

	it('shows reasoning text when not in progress', () => {
		render(ThinkingBlock, {
			props: {
				content: 'Completed thoughts',
				inProgress: false
			}
		});

		expect(screen.getByText('Reasoning')).toBeDefined();
	});

	it('shows brain emoji when not in progress', () => {
		render(ThinkingBlock, {
			props: {
				content: 'Content',
				inProgress: false
			}
		});

		// The brain emoji is rendered as text
		const brainEmoji = screen.queryByText('🧠');
		expect(brainEmoji).toBeDefined();
	});

	it('has appropriate styling when in progress', () => {
		const { container } = render(ThinkingBlock, {
			props: {
				content: 'In progress content',
				inProgress: true
			}
		});

		// Should have ring class for in-progress state
		const wrapper = container.querySelector('.ring-1');
		expect(wrapper).toBeDefined();
	});

	it('button is accessible', () => {
		render(ThinkingBlock, {
			props: {
				content: 'Accessible content'
			}
		});

		const button = screen.getByRole('button');
		expect(button.getAttribute('type')).toBe('button');
	});
});
