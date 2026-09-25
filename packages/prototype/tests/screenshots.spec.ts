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
	{ name: 'resources', path: '/screens/resources' },
	{ name: 'settings', path: '/screens/settings' },
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
