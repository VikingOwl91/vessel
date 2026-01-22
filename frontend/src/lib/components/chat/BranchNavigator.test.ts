/**
 * BranchNavigator component tests
 *
 * Tests the message branch navigation component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BranchNavigator from './BranchNavigator.svelte';

describe('BranchNavigator', () => {
	const defaultBranchInfo = {
		currentIndex: 0,
		totalCount: 3,
		siblingIds: ['msg-1', 'msg-2', 'msg-3']
	};

	it('renders with branch info', () => {
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo
			}
		});

		// Should show 1/3 (currentIndex + 1)
		expect(screen.getByText('1/3')).toBeDefined();
	});

	it('renders navigation role', () => {
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo
			}
		});

		const nav = screen.getByRole('navigation');
		expect(nav).toBeDefined();
		expect(nav.getAttribute('aria-label')).toContain('branch navigation');
	});

	it('has prev and next buttons', () => {
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo
			}
		});

		const buttons = screen.getAllByRole('button');
		expect(buttons).toHaveLength(2);
		expect(buttons[0].getAttribute('aria-label')).toContain('Previous');
		expect(buttons[1].getAttribute('aria-label')).toContain('Next');
	});

	it('calls onSwitch with prev when prev button clicked', async () => {
		const onSwitch = vi.fn();
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo,
				onSwitch
			}
		});

		const prevButton = screen.getAllByRole('button')[0];
		await fireEvent.click(prevButton);

		expect(onSwitch).toHaveBeenCalledWith('prev');
	});

	it('calls onSwitch with next when next button clicked', async () => {
		const onSwitch = vi.fn();
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo,
				onSwitch
			}
		});

		const nextButton = screen.getAllByRole('button')[1];
		await fireEvent.click(nextButton);

		expect(onSwitch).toHaveBeenCalledWith('next');
	});

	it('updates display when currentIndex changes', () => {
		const { rerender } = render(BranchNavigator, {
			props: {
				branchInfo: { ...defaultBranchInfo, currentIndex: 1 }
			}
		});

		expect(screen.getByText('2/3')).toBeDefined();

		rerender({
			branchInfo: { ...defaultBranchInfo, currentIndex: 2 }
		});

		expect(screen.getByText('3/3')).toBeDefined();
	});

	it('handles keyboard navigation with left arrow', async () => {
		const onSwitch = vi.fn();
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo,
				onSwitch
			}
		});

		const nav = screen.getByRole('navigation');
		await fireEvent.keyDown(nav, { key: 'ArrowLeft' });

		expect(onSwitch).toHaveBeenCalledWith('prev');
	});

	it('handles keyboard navigation with right arrow', async () => {
		const onSwitch = vi.fn();
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo,
				onSwitch
			}
		});

		const nav = screen.getByRole('navigation');
		await fireEvent.keyDown(nav, { key: 'ArrowRight' });

		expect(onSwitch).toHaveBeenCalledWith('next');
	});

	it('is focusable for keyboard navigation', () => {
		render(BranchNavigator, {
			props: {
				branchInfo: defaultBranchInfo
			}
		});

		const nav = screen.getByRole('navigation');
		expect(nav.getAttribute('tabindex')).toBe('0');
	});

	it('shows correct count for single message', () => {
		render(BranchNavigator, {
			props: {
				branchInfo: {
					currentIndex: 0,
					totalCount: 1,
					siblingIds: ['msg-1']
				}
			}
		});

		expect(screen.getByText('1/1')).toBeDefined();
	});
});
