import { userEvent } from 'vitest/browser';

/** Presses a spot outside every overlay that holds nothing focusable, so the press leaves focus on the page body. */
async function pressOutside(): Promise<void> {
	const outside = document.createElement('div');
	outside.textContent = 'Outside';
	outside.style.cssText = 'position: fixed; top: 0; right: 0; padding: 1rem;';
	document.body.append(outside);
	try {
		await userEvent.click(outside);
	} finally {
		outside.remove();
	}
}

/** Each way an operator dismisses an overlay, named for `test.each`. */
export const dismissals: [name: string, dismiss: () => Promise<void>][] = [
	['a press outside', pressOutside],
	['Escape', () => userEvent.keyboard('{Escape}')],
	['a window blur', async () => void dispatchEvent(new Event('blur'))]
];
