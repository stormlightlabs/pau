import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, VENDOR_DIR, verifyVendor } from '../scripts/vendor.ts';

describe('vendored upstream files', () => {
	it('match the hashes recorded in SOURCE.md', () => {
		expect(verifyVendor()).toEqual([]);
	});

	it('record release 40.3.0 at its commit', () => {
		expect(readSource()).toMatchObject({ release: '40.3.0', commit: 'fefa477b3b96c8ec23db223349dadbd183a1796a' });
	});

	it("keep upstream's MIT license and copyright", () => {
		const license = readFileSync(path.join(VENDOR_DIR, 'LICENSE'), 'utf8');
		expect(license).toMatch(/^MIT License\n\nCopyright \(c\) 2026 MasuRii and Christopher D\. Lasher\n/);
		expect(readSource().files.has('LICENSE')).toBe(true);
	});
});
