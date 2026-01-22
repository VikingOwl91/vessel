/**
 * ConfirmDialog component tests
 *
 * Tests the confirmation dialog component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
	const defaultProps = {
		isOpen: true,
		title: 'Confirm Action',
		message: 'Are you sure you want to proceed?',
		onConfirm: vi.fn(),
		onCancel: vi.fn()
	};

	it('does not render when closed', () => {
		render(ConfirmDialog, {
			props: {
				...defaultProps,
				isOpen: false
			}
		});

		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('renders when open', () => {
		render(ConfirmDialog, { props: defaultProps });

		const dialog = screen.getByRole('dialog');
		expect(dialog).toBeDefined();
		expect(dialog.getAttribute('aria-modal')).toBe('true');
	});

	it('displays title and message', () => {
		render(ConfirmDialog, { props: defaultProps });

		expect(screen.getByText('Confirm Action')).toBeDefined();
		expect(screen.getByText('Are you sure you want to proceed?')).toBeDefined();
	});

	it('uses default button text', () => {
		render(ConfirmDialog, { props: defaultProps });

		expect(screen.getByText('Confirm')).toBeDefined();
		expect(screen.getByText('Cancel')).toBeDefined();
	});

	it('uses custom button text', () => {
		render(ConfirmDialog, {
			props: {
				...defaultProps,
				confirmText: 'Delete',
				cancelText: 'Keep'
			}
		});

		expect(screen.getByText('Delete')).toBeDefined();
		expect(screen.getByText('Keep')).toBeDefined();
	});

	it('calls onConfirm when confirm button clicked', async () => {
		const onConfirm = vi.fn();
		render(ConfirmDialog, {
			props: {
				...defaultProps,
				onConfirm
			}
		});

		const confirmButton = screen.getByText('Confirm');
		await fireEvent.click(confirmButton);

		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('calls onCancel when cancel button clicked', async () => {
		const onCancel = vi.fn();
		render(ConfirmDialog, {
			props: {
				...defaultProps,
				onCancel
			}
		});

		const cancelButton = screen.getByText('Cancel');
		await fireEvent.click(cancelButton);

		expect(onCancel).toHaveBeenCalledOnce();
	});

	it('calls onCancel when Escape key pressed', async () => {
		const onCancel = vi.fn();
		render(ConfirmDialog, {
			props: {
				...defaultProps,
				onCancel
			}
		});

		const dialog = screen.getByRole('dialog');
		await fireEvent.keyDown(dialog, { key: 'Escape' });

		expect(onCancel).toHaveBeenCalledOnce();
	});

	it('has proper aria attributes', () => {
		render(ConfirmDialog, { props: defaultProps });

		const dialog = screen.getByRole('dialog');
		expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
		expect(dialog.getAttribute('aria-describedby')).toBe('confirm-dialog-description');
	});

	describe('variants', () => {
		it('renders danger variant with red styling', () => {
			render(ConfirmDialog, {
				props: {
					...defaultProps,
					variant: 'danger'
				}
			});

			const confirmButton = screen.getByText('Confirm');
			expect(confirmButton.className).toContain('bg-red-600');
		});

		it('renders warning variant with amber styling', () => {
			render(ConfirmDialog, {
				props: {
					...defaultProps,
					variant: 'warning'
				}
			});

			const confirmButton = screen.getByText('Confirm');
			expect(confirmButton.className).toContain('bg-amber-600');
		});

		it('renders info variant with emerald styling', () => {
			render(ConfirmDialog, {
				props: {
					...defaultProps,
					variant: 'info'
				}
			});

			const confirmButton = screen.getByText('Confirm');
			expect(confirmButton.className).toContain('bg-emerald-600');
		});
	});
});
