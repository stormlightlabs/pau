import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import Select, { type SelectOption } from '../lib/Select.svelte';

type Fruit = 'apple' | 'apricot' | 'banana' | 'blueberry' | 'cherry';

const options: SelectOption<Fruit>[] = [
	{ value: 'apple', label: 'Apple' },
	{ value: 'apricot', label: 'Apricot' },
	{ value: 'banana', label: 'Banana', description: 'Ripe on Thursday' },
	{ value: 'blueberry', label: 'Blueberry', disabled: true, disabledReason: 'Out of season' },
	{ value: 'cherry', label: 'Cherry' }
];

const trigger = () => page.getByRole('combobox', { name: 'Fruit' });
const option = (name: string) => page.getByRole('option', { name });

async function renderSelect(props: Partial<{ value: Fruit; onChange: (value: Fruit) => void | Promise<void> }> = {}) {
	const onChange = props.onChange ?? vi.fn();
	const result = await render(Select<Fruit>, { label: 'Fruit', options, value: 'apple', ...props, onChange });
	return { onChange, ...result };
}

function activeOption(): string | undefined {
	const id = trigger().element().getAttribute('aria-activedescendant');
	return id ? document.getElementById(id)?.textContent?.trim() : undefined;
}

test('shows the label of the current value and links the trigger to its list', async () => {
	await renderSelect({ value: 'banana' });

	await expect.element(trigger()).toHaveTextContent('Banana');
	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
	const listId = trigger().element().getAttribute('aria-controls');
	expect(document.getElementById(listId ?? '')?.getAttribute('role')).toBe('listbox');
});

test.each(['Enter', ' ', 'ArrowDown', 'Alt+ArrowDown'])('%s opens the list on the selected option', async (key) => {
	await renderSelect({ value: 'banana' });
	trigger().element().focus();

	await userEvent.keyboard(key === 'Alt+ArrowDown' ? '{Alt>}{ArrowDown}{/Alt}' : `{${key === ' ' ? 'Space' : key}}`);

	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'true');
	await expect.element(option('Banana')).toHaveAttribute('aria-selected', 'true');
	expect(activeOption()).toMatch(/^Banana/);
	expect(document.activeElement).toBe(trigger().element());
});

test('arrows, Home, and End move the active option without selecting it', async () => {
	const { onChange } = await renderSelect();
	trigger().element().focus();

	await userEvent.keyboard('{ArrowDown}');
	await userEvent.keyboard('{ArrowDown}');
	expect(activeOption()).toBe('Apricot');
	await userEvent.keyboard('{End}');
	expect(activeOption()).toBe('Cherry');
	await userEvent.keyboard('{ArrowDown}');
	expect(activeOption()).toBe('Cherry');
	await userEvent.keyboard('{Home}');
	expect(activeOption()).toBe('Apple');
	await userEvent.keyboard('{ArrowUp}');
	expect(activeOption()).toBe('Apple');
	expect(onChange).not.toHaveBeenCalled();
});

test('Enter and Space select the active option, close the list, and keep focus on the trigger', async () => {
	const { onChange } = await renderSelect();
	trigger().element().focus();

	await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
	expect(onChange).toHaveBeenLastCalledWith('apricot');
	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
	await expect.element(trigger()).toHaveTextContent('Apricot');

	await userEvent.keyboard('{ArrowDown}{End}{Space}');
	expect(onChange).toHaveBeenLastCalledWith('cherry');
	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
	expect(document.activeElement).toBe(trigger().element());
});

test('typeahead matches a typed prefix and cycles on a repeated letter', async () => {
	await renderSelect();
	trigger().element().focus();

	await userEvent.keyboard('b');
	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'true');
	expect(activeOption()).toMatch(/^Banana/);
	await userEvent.keyboard('b');
	expect(activeOption()).toMatch(/^Blueberry/);
	await userEvent.keyboard('{Escape}');
	await new Promise((resolve) => setTimeout(resolve, 600));
	await userEvent.keyboard('{ArrowDown}');
	await userEvent.keyboard('apr');
	expect(activeOption()).toBe('Apricot');
});

test('Escape closes without a change and returns focus to the trigger', async () => {
	const { onChange } = await renderSelect();
	await userEvent.click(trigger());
	await expect.element(option('Cherry')).toBeVisible();

	await userEvent.keyboard('{ArrowDown}{Escape}');

	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
	expect(onChange).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(trigger().element());
});

test('Tab closes the list and moves on', async () => {
	const { onChange } = await renderSelect();
	trigger().element().focus();

	await userEvent.keyboard('{ArrowDown}{ArrowDown}');
	await userEvent.tab();

	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
	expect(onChange).not.toHaveBeenCalled();
});

test('a pointer chooses an option and focus stays on the trigger', async () => {
	const { onChange } = await renderSelect();

	await userEvent.click(trigger());
	await userEvent.click(option('Cherry'));

	expect(onChange).toHaveBeenCalledWith('cherry');
	await expect.element(trigger()).toHaveTextContent('Cherry');
	expect(document.activeElement).toBe(trigger().element());
});

test('a disabled option explains itself and cannot be chosen', async () => {
	const { onChange } = await renderSelect();
	await userEvent.click(trigger());

	await expect.element(option('Blueberry')).toHaveAttribute('aria-disabled', 'true');
	await expect.element(option('Blueberry')).toHaveAccessibleDescription('Out of season');
	await expect.element(option('Banana')).toHaveAccessibleDescription('Ripe on Thursday');
	await userEvent.click(option('Blueberry'), { force: true });

	expect(onChange).not.toHaveBeenCalled();
	await expect.element(trigger()).toHaveAttribute('aria-expanded', 'true');
});

test('a disabled control explains why', async () => {
	await render(Select<Fruit>, {
		label: 'Fruit',
		options,
		value: 'apple',
		disabled: true,
		disabledReason: 'Wait for the run to finish.'
	});

	await expect.element(trigger()).toBeDisabled();
	await expect.element(trigger()).toHaveAccessibleDescription('Wait for the run to finish.');
	await expect.element(trigger()).toHaveAttribute('title', 'Wait for the run to finish.');
});

test('shows a pending choice, then restores the previous value when the change is rejected', async () => {
	const change = Promise.withResolvers<void>();
	const onChange = vi.fn(() => change.promise);
	await renderSelect({ onChange });

	await userEvent.click(trigger());
	await userEvent.click(option('Cherry'));
	await expect.element(trigger()).toHaveTextContent('Cherry');
	await expect.element(trigger()).toHaveAttribute('aria-busy', 'true');

	change.reject(new Error('The fruit stand is closed'));

	await expect.element(page.getByRole('alert')).toHaveTextContent('The fruit stand is closed');
	await expect.element(trigger()).toHaveTextContent('Apple');
	await expect.element(trigger()).not.toHaveAttribute('aria-busy');
	expect(document.activeElement).toBe(trigger().element());
});

test('the list escapes a clipping scroll container', async () => {
	const { container } = await renderSelect();
	container.style.cssText = 'height: 3rem; overflow: auto;';

	await userEvent.click(trigger());
	const cherry = option('Cherry').element();
	await expect.element(option('Cherry')).toBeVisible();

	const box = cherry.getBoundingClientRect();
	expect(box.top).toBeGreaterThan(container.getBoundingClientRect().bottom);
	expect(cherry.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
});

test('the list opens above the trigger near the bottom of the viewport', async () => {
	const { container } = await renderSelect();
	container.style.cssText = `position: fixed; left: 1rem; top: ${innerHeight - 48}px;`;

	await userEvent.click(trigger());
	await expect.element(option('Cherry')).toBeVisible();

	const list = page.getByRole('listbox').element().getBoundingClientRect();
	expect(list.bottom).toBeLessThanOrEqual(trigger().element().getBoundingClientRect().top);
});

test.each([
	[600, 'left'],
	[600, 'right'],
	[1440, 'left'],
	[1440, 'right']
])('a rejection message stays inside a %ipx window with the trigger at the %s edge', async (width, side) => {
	await page.viewport(width, 400);
	const onChange = vi.fn().mockRejectedValue(new Error('The fruit stand is closed until the next delivery arrives.'));
	const { container } = await renderSelect({ onChange });
	container.style.cssText = `position: fixed; top: 1rem; ${side}: 1rem;`;

	await userEvent.click(trigger());
	await userEvent.click(option('Cherry'));

	const alert = page.getByRole('alert');
	await expect.element(alert).toBeVisible();
	const box = alert.element().getBoundingClientRect();
	const anchor = trigger().element().getBoundingClientRect();
	expect(box.left).toBeGreaterThanOrEqual(0);
	expect(box.right).toBeLessThanOrEqual(innerWidth);
	expect(box.top).toBeGreaterThan(anchor.bottom);
	// Like the list, the message starts at the trigger's leading edge when it fits.
	if (side === 'left') expect(box.left).toBe(anchor.left);
});
