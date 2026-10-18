import { vi } from 'vitest';

/** Replaces `navigator.clipboard` for a test and returns the `writeText` spy. */
export function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
	return writeText;
}
