import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'line',
	use: { baseURL: 'http://127.0.0.1:4174', colorScheme: 'dark', trace: 'retain-on-failure' },
	projects: [
		{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
		{ name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', colorScheme: 'dark' } }
	],
	webServer: { command: 'pnpm preview --host 127.0.0.1 --port 4174', port: 4174, reuseExistingServer: !process.env.CI }
});
