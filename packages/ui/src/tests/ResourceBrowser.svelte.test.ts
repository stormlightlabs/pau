import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { emptyResourceIndex, largeResourceIndex, resourceIndex, untrustedResourceIndex } from '../fixtures/resources';
import ResourceBrowser from '../lib/ResourceBrowser.svelte';
import { RESOURCE_KIND_LABELS, RESOURCE_KINDS } from '../lib/resource-browser';
import type { ResourceIndex, ResourceKind } from '../lib/types/resources';

const kindHref = (kind: ResourceKind) => `/resources/${kind}s`;

async function renderBrowser(
	kind: ResourceKind,
	props: { index?: ResourceIndex; error?: string; onRetry?: () => void }
) {
	return render(ResourceBrowser, { workspaceName: 'pau', kind, kindHref, ...props });
}

const list = (kind: ResourceKind) => page.getByRole('listbox', { name: RESOURCE_KIND_LABELS[kind] });
const row = (name: string | RegExp) => page.getByRole('option', { name });
const inspector = () => page.getByRole('complementary', { name: 'Inspector' });

/** A resource of each kind from the fixture, made invalid. */
function withInvalid(kind: ResourceKind): ResourceIndex {
	const resources = resourceIndex.resources.map((resource) =>
		resource.kind === kind && resource.name === firstName(kind)
			? { ...resource, status: 'invalid' as const, warnings: ['Cannot read file: Permission denied'] }
			: resource
	);
	return { ...resourceIndex, resources };
}

function firstName(kind: ResourceKind): string {
	return resourceIndex.resources.find((resource) => resource.kind === kind)!.name;
}

test.each(RESOURCE_KINDS)('shows loading, error, and empty states for %s', async (kind) => {
	const label = RESOURCE_KIND_LABELS[kind];
	await page.viewport(1440, 900);
	const view = await renderBrowser(kind, {});
	await expect.element(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
	await expect.element(page.getByRole('status').getByText('Loading resources')).toBeVisible();

	const onRetry = vi.fn();
	await view.rerender({ error: 'The local API stopped responding.', onRetry });
	await expect.element(page.getByRole('alert')).toHaveTextContent('The local API stopped responding.');
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));
	expect(onRetry).toHaveBeenCalledOnce();

	await view.rerender({ error: undefined, index: emptyResourceIndex });
	await expect.element(page.getByRole('heading', { name: `No ${label.toLowerCase()} found` })).toBeVisible();
	expect(list(kind).elements()).toHaveLength(0);
	await expect.element(inspector()).not.toBeInTheDocument();
});

test.each(RESOURCE_KINDS)('lists an invalid %s with its warning', async (kind) => {
	await page.viewport(1440, 900);
	await renderBrowser(kind, { index: withInvalid(kind) });
	const name = firstName(kind);

	await expect.element(rowStarting(name)).toHaveTextContent('Invalid');
	await userEvent.click(rowStarting(name));
	await expect.element(inspector().getByRole('heading', { name })).toBeVisible();
	await expect.element(inspector()).toHaveTextContent('Not loaded. The file has errors listed under Warnings.');
	await expect.element(inspector().getByRole('listitem')).toHaveTextContent('Cannot read file: Permission denied');
	// Valid resources stay listed beside it.
	expect(list(kind).getByRole('option').elements().length).toBe(
		resourceIndex.resources.filter((resource) => resource.kind === kind).length
	);
});

test.each(RESOURCE_KINDS)('marks untrusted project %s and keeps them inspectable', async (kind) => {
	await page.viewport(1440, 900);
	await renderBrowser(kind, { index: untrustedResourceIndex });

	await expect.element(page.getByText(/You declined to trust this workspace/)).toBeVisible();
	const ofKind = untrustedResourceIndex.resources.filter((resource) => resource.kind === kind);
	const project = ofKind.find(
		(resource) =>
			resource.scope === 'project' &&
			resource.status === 'ready' &&
			ofKind.filter((other) => other.name.startsWith(resource.name)).length === 1
	)!;
	const projectRow = rowStarting(project.name);
	await expect.element(projectRow).toHaveTextContent('Not trusted');
	await userEvent.click(projectRow);
	await expect
		.element(inspector())
		.toHaveTextContent('Not trusted. You declined this workspace, so Pi skips its project resources.');
});

test.each(RESOURCE_KINDS)('lists user and project %s and filters by scope', async (kind) => {
	await page.viewport(1440, 900);
	await renderBrowser(kind, { index: resourceIndex });
	const ofKind = resourceIndex.resources.filter((resource) => resource.kind === kind);
	const project = ofKind.filter((resource) => resource.scope === 'project');

	const options = list(kind).getByRole('option');
	expect(options.elements()).toHaveLength(ofKind.length);
	expect(options.elements().some((option) => option.textContent?.includes('User'))).toBe(true);
	expect(options.elements().some((option) => option.textContent?.includes('Project'))).toBe(true);

	await userEvent.click(page.getByRole('combobox', { name: 'Scope' }));
	await userEvent.click(page.getByRole('option', { name: 'Project', exact: true }));
	expect(list(kind).getByRole('option').elements()).toHaveLength(project.length);
	await expect
		.element(page.getByText(`${project.length} of ${ofKind.length} ${RESOURCE_KIND_LABELS[kind].toLowerCase()}`))
		.toBeVisible();
});

test('shows a duplicate with the resource that loads instead', async () => {
	await page.viewport(1440, 900);
	await renderBrowser('prompt', { index: resourceIndex });
	const duplicate = list('prompt').getByRole('option').filter({ hasText: 'Duplicate' });

	await userEvent.click(duplicate);
	await expect.element(inspector()).toHaveTextContent('Another prompt named review loads first.');
	await expect.element(inspector()).toHaveTextContent('/Users/ada/src/pau/.pi/prompts/review.md');
});

test('links each view in the rail with its count', async () => {
	await page.viewport(1440, 900);
	await renderBrowser('skill', { index: resourceIndex });
	const rail = page.getByRole('complementary', { name: 'Resources' });

	await expect.element(rail.getByRole('link', { name: 'Skills 35' })).toHaveAttribute('aria-current', 'page');
	await expect.element(rail.getByRole('link', { name: 'Packages 5' })).toHaveAttribute('href', '/resources/packages');
	await expect.element(page.getByText('Discovery warnings')).toBeVisible();
	await expect.element(page.getByText('Broken symbolic link.')).toBeVisible();
});

test('filters three hundred skills by name and trust', async () => {
	await page.viewport(1440, 900);
	await renderBrowser('skill', { index: largeResourceIndex });

	await expect.element(page.getByText('300 skills')).toBeVisible();
	await userEvent.fill(page.getByRole('searchbox', { name: 'Filter by name' }), 'skill-29');
	await expect.element(page.getByText('10 of 300 skills')).toBeVisible();
	expect(list('skill').getByRole('option').elements()).toHaveLength(10);

	await userEvent.fill(page.getByRole('searchbox', { name: 'Filter by name' }), '');
	await userEvent.click(page.getByRole('combobox', { name: 'Trust' }));
	await userEvent.click(page.getByRole('option', { name: 'Trust not decided', exact: true }));
	await expect.element(page.getByText('100 of 300 skills')).toBeVisible();

	await userEvent.fill(page.getByRole('searchbox', { name: 'Filter by name' }), 'no such skill');
	await expect.element(page.getByRole('heading', { name: 'No skills match these filters' })).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Clear filters' }));
	await expect.element(page.getByText('300 skills')).toBeVisible();
	await expect.element(page.getByRole('combobox', { name: 'Trust' })).toHaveTextContent('Any trust');
});

test('moves through the list with the keyboard and updates the inspector', async () => {
	await page.viewport(1440, 900);
	await renderBrowser('skill', { index: largeResourceIndex });
	const search = page.getByRole('searchbox', { name: 'Filter by name' });

	await userEvent.click(search);
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(row(/^skill-000/)).toHaveFocus();
	await expect.element(row(/^skill-000/)).toHaveAttribute('aria-selected', 'true');
	await userEvent.keyboard('{ArrowDown}{ArrowDown}');
	await expect.element(row(/^skill-002/)).toHaveFocus();
	await expect.element(inspector().getByRole('heading', { name: 'skill-002' })).toBeVisible();
	await userEvent.keyboard('{End}');
	await expect.element(row(/^skill-299/)).toHaveFocus();
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(row(/^skill-299/)).toHaveFocus();
	await userEvent.keyboard('{Home}{ArrowUp}');
	await expect.element(row(/^skill-000/)).toHaveFocus();
	// Only the selected row is in the tab order.
	expect(list('skill').element().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
});

test('opens the detail in place of the list on a narrow window and returns to the row', async () => {
	await page.viewport(900, 700);
	await renderBrowser('skill', { index: largeResourceIndex });

	await expect.element(inspector()).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('searchbox', { name: 'Filter by name' }));
	await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
	const back = page.getByRole('button', { name: 'Back to Skills' });
	await expect.element(back).toHaveFocus();
	await expect.element(page.getByRole('heading', { name: 'skill-001' })).toBeVisible();
	expect(list('skill').elements()).toHaveLength(0);

	await userEvent.keyboard('{Escape}');
	await expect.element(row(/^skill-001/)).toHaveFocus();

	await userEvent.click(row(/^skill-004/));
	await userEvent.click(page.getByRole('button', { name: 'Back to Skills' }));
	await expect.element(row(/^skill-004/)).toHaveFocus();
	const main = document.querySelector<HTMLElement>('#main-surface')!;
	expect(main.scrollWidth).toBe(main.clientWidth);
});

/** The row whose accessible name starts with `name`. */
function rowStarting(name: string) {
	return row(new RegExp(`^${name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`));
}
