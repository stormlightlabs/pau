import { describe, expect, test } from 'vitest';

import { reroute } from './hooks';

const route = (href: string) => reroute({ url: new URL(href), fetch });

describe('reroute', () => {
	test('serves the bundled index.html as the root route', () => {
		expect(route('tauri://localhost/index.html?pau-api-port=1&pau-api-token=t')).toBe('/');
	});

	test('leaves other routes alone', () => {
		expect(route('tauri://localhost/workspaces/w/sessions/s')).toBeUndefined();
		expect(route('http://localhost:5173/')).toBeUndefined();
	});
});
