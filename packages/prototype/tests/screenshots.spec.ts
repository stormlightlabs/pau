import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const screens = [
	{ name: 'hub', path: '/' },
	{ name: 'dashboard', path: '/screens/dashboard' },
	{ name: 'session', path: '/screens/session' },
	{ name: 'orchestration', path: '/screens/orchestration' },
	{ name: 'scratchpad', path: '/screens/scratchpad' },
	{ name: 'editor', path: '/screens/editor' },
	{ name: 'neovim', path: '/screens/neovim' },
	{ name: 'terminal', path: '/screens/terminal' },
	{ name: 'processes', path: '/screens/processes' },
	{ name: 'resources', path: '/screens/resources' },
	{ name: 'settings', path: '/screens/settings' },
	{ name: 'docs', path: '/docs' },
	{ name: 'launch', path: '/splash/launch' },
	{ name: 'reconnect', path: '/splash/reconnect' }
] as const;

async function prepareScreenshot(page: import('@playwright/test').Page) {
	await expect(page.locator('[data-prototype-ready]')).toBeVisible();
	await page.addStyleTag({
		content: '*, *::before, *::after { animation: none !important; transition: none !important; }'
	});
	await page.evaluate(() => document.fonts.ready);
}

async function screenshotPath(testInfo: import('@playwright/test').TestInfo, name: string) {
	const directory = join(process.cwd(), 'screenshots', testInfo.project.name);
	await mkdir(directory, { recursive: true });
	return join(directory, `${name}.png`);
}

for (const screen of screens) {
	test(`${screen.name} screenshot`, async ({ page }, testInfo) => {
		await page.goto(screen.path);
		await prepareScreenshot(page);
		await page.screenshot({ path: await screenshotPath(testInfo, screen.name), fullPage: true });
	});
}

test('prototype shell contains scrolling and animates task views', async ({ page }) => {
	await page.goto('/docs');
	await expect(page.locator('[data-prototype-ready]')).toBeVisible();

	const shellState = await page.evaluate(() => {
		const main = document.querySelector<HTMLElement>('.prototype-main');
		const nav = document.querySelector<HTMLElement>('.prototype-nav');
		const view = document.querySelector<HTMLElement>('.prototype-main__view');
		if (!main || !nav || !view) throw new Error('Prototype shell is missing');

		main.scrollTop = 320;
		return {
			documentOverflow: getComputedStyle(document.documentElement).overflow,
			documentOverscroll: getComputedStyle(document.documentElement).overscrollBehavior,
			mainOverflow: getComputedStyle(main).overflowY,
			mainOverscroll: getComputedStyle(main).overscrollBehavior,
			mainScrollTop: main.scrollTop,
			navOverflow: getComputedStyle(nav).overflowY,
			navScrollTop: nav.scrollTop,
			viewAnimation: getComputedStyle(view).animationName
		};
	});

	expect(shellState).toEqual({
		documentOverflow: 'hidden',
		documentOverscroll: 'none',
		mainOverflow: 'auto',
		mainOverscroll: 'none',
		mainScrollTop: 320,
		navOverflow: test.info().project.name === 'mobile' ? 'hidden' : 'auto',
		navScrollTop: 0,
		viewAnimation: 'prototype-view-enter'
	});

	await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
	await expect(page).toHaveURL(/\/screens\/dashboard$/);
	await expect(page.locator('.prototype-main')).toHaveJSProperty('scrollTop', 0);
	await expect(page.locator('.prototype-main__view')).toHaveCSS('animation-name', 'prototype-view-enter');
});

test('docs views and controls', async ({ page }) => {
	await page.goto('/docs');
	await prepareScreenshot(page);

	await page.getByRole('button', { name: 'Files', exact: true }).click();
	await expect(page.getByText('Inspect the work, not just the transcript')).toBeVisible();
	await page.getByRole('button', { name: /surfaces\.md/ }).click();
	await expect(page.getByText('+ Each preview follows its real task.')).toBeVisible();

	await page.getByRole('button', { name: 'MCP', exact: true }).click();
	await page.getByRole('button', { name: 'Test connection' }).click();
	await expect(page.getByText('Connection passed')).toBeVisible();

	await page.getByRole('button', { name: 'Sessions', exact: true }).click();
	await page.getByRole('button', { name: /Review MCP diagnostics/ }).click();
	await expect(page.getByText('Waiting for direction')).toBeVisible();
	await page.getByRole('button', { name: 'Steer' }).click();
	await expect(page.getByText('Direction queued for this turn')).toBeVisible();

	await page.getByRole('button', { name: 'Use dark theme' }).click();
	await expect(page.locator('.docs-frame')).toHaveAttribute('data-theme', 'dark');

	await page.getByRole('button', { name: 'Guide', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();

	await page.getByRole('button', { name: 'Reference', exact: true }).click();
	await page.getByRole('searchbox', { name: 'Filter capabilities' }).fill('sandbox');
	await expect(page.getByRole('heading', { name: 'Local sandbox and resource monitoring' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Concurrent Pi and Claude sessions' })).toBeHidden();
});

test('docs guide screenshot', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The landing view covers the narrow website composition.');
	await page.goto('/docs');
	await prepareScreenshot(page);
	await page.getByRole('button', { name: 'Guide', exact: true }).click();
	await page.screenshot({ path: await screenshotPath(testInfo, 'docs-guide'), fullPage: true });
});

test('docs reference dark screenshot', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The landing view covers the narrow website composition.');
	await page.goto('/docs');
	await prepareScreenshot(page);
	await page.getByRole('button', { name: 'Use dark theme' }).click();
	await page.getByRole('button', { name: 'Reference', exact: true }).click();
	await page.screenshot({ path: await screenshotPath(testInfo, 'docs-reference-dark'), fullPage: true });
});

test('focused session screenshot', async ({ page }, testInfo) => {
	await page.goto('/screens/session');
	await prepareScreenshot(page);
	await page.getByRole('button', { name: 'Enter focus mode' }).click();
	await expect(page.getByRole('navigation', { name: 'Product areas' })).toBeHidden();
	await expect(page.getByRole('complementary', { name: 'Sessions' })).toBeHidden();
	await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
	await page.screenshot({ path: await screenshotPath(testInfo, 'session-focused'), fullPage: true });
});

test('dashboard activity panel screenshot', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The panel becomes a dedicated view at narrow widths.');
	await page.goto('/screens/dashboard');
	await prepareScreenshot(page);
	await page.getByRole('button', { name: 'Activity' }).click();
	await expect(page.getByRole('complementary', { name: 'Workspace activity' })).toBeVisible();
	await page.screenshot({ path: await screenshotPath(testInfo, 'dashboard-activity'), fullPage: true });
});

test('orchestration details panel screenshot', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The panel becomes a dedicated view at narrow widths.');
	await page.goto('/screens/orchestration');
	await prepareScreenshot(page);
	await page.getByRole('button', { name: 'Toggle run details' }).click();
	await expect(page.getByRole('complementary', { name: 'Run details' })).toBeVisible();
	await page.screenshot({ path: await screenshotPath(testInfo, 'orchestration-details'), fullPage: true });
});
