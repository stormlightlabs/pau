import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { capabilityFixtures } from '../fixtures/capabilities';
import CapabilityCard from '../lib/CapabilityCard.svelte';

test('toggles a capability from the keyboard', async () => {
	await render(CapabilityCard, { capability: capabilityFixtures.available });
	const toggle = page.getByRole('button', { name: 'Disable' });

	await userEvent.tab();
	await expect.element(toggle).toHaveFocus();
	await userEvent.keyboard('{Enter}');

	await expect.element(page.getByText('Unavailable')).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Enable' })).toHaveAttribute('aria-pressed', 'false');
});
