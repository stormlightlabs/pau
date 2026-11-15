/**
 * The release build stages the sandbox extension and checks that it imports
 * from the stage alone. These tests build a real stage, then break copies of
 * it the ways a bad stage can break.
 *
 * Only macOS releases ship the stage, and it keeps only the macOS native
 * files, so the tests run on macOS.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const stage = path.join(root, 'target/sandbox-bundle');

/** The environment without signing credentials or Node resolution overrides. */
function plainEnv() {
	const env = { ...process.env };
	for (const name of ['APPLE_SIGNING_IDENTITY', 'APPLE_CERTIFICATE', 'NODE_PATH', 'NODE_OPTIONS']) delete env[name];
	return env;
}

function checkStage(directory: string) {
	return spawnSync(process.execPath, [path.join(scripts, 'check-sandbox-bundle.mjs')], {
		cwd: directory,
		env: plainEnv(),
		encoding: 'utf8'
	});
}

describe.runIf(process.platform === 'darwin')('the staged sandbox extension', () => {
	let temp = '';
	let build: ReturnType<typeof spawnSync>;

	beforeAll(() => {
		build = spawnSync(process.execPath, [path.join(scripts, 'bundle-sandbox.mjs')], {
			cwd: root,
			env: plainEnv(),
			encoding: 'utf8'
		});
		const prefix = path.join(tmpdir(), 'pau-sandbox-stage-');
		temp = realpathSync(mkdtempSync(prefix));
	}, 120_000);

	afterAll(() => rmSync(temp, { recursive: true, force: true }));

	test('builds and imports from the stage', () => {
		expect(build.stderr).not.toContain('does not load');
		expect(build.status).toBe(0);
		const check = checkStage(stage);
		expect(check.stderr).toBe('');
		expect(check.status).toBe(0);
	});

	test.each([
		{
			breakage: 'a missing runtime dependency',
			breakCopy: (copy: string) =>
				rmSync(path.join(copy, 'node_modules/@anthropic-ai/sandbox-runtime'), { recursive: true }),
			error: "Cannot find package '@anthropic-ai/sandbox-runtime'"
		},
		{
			breakage: 'a dependency only a parent directory holds',
			breakCopy: (copy: string) => {
				mkdirSync(path.join(copy, '../node_modules'));
				renameSync(path.join(copy, 'node_modules/typebox'), path.join(copy, '../node_modules/typebox'));
			},
			error: 'typebox resolves outside the stage'
		},
		{
			breakage: 'a pruned extension source',
			breakCopy: (copy: string) => rmSync(path.join(copy, 'src/launcher.ts')),
			error: 'launcher.ts'
		}
	])('fails on $breakage', ({ breakage, breakCopy, error }) => {
		const copy = path.join(temp, breakage, 'stage');
		cpSync(stage, copy, { recursive: true });
		breakCopy(copy);

		const check = checkStage(copy);
		expect(check.stderr).toContain(error);
		expect(check.status).toBe(1);
	});
});
