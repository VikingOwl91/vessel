/**
 * Mock for $app/navigation
 */

import { vi } from 'vitest';

export const goto = vi.fn().mockResolvedValue(undefined);
export const invalidate = vi.fn().mockResolvedValue(undefined);
export const invalidateAll = vi.fn().mockResolvedValue(undefined);
export const preloadData = vi.fn().mockResolvedValue(undefined);
export const preloadCode = vi.fn().mockResolvedValue(undefined);
export const beforeNavigate = vi.fn();
export const afterNavigate = vi.fn();
export const onNavigate = vi.fn();
