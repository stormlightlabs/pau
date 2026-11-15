/**
 * The installed app may sit under a directory whose name holds a space or a
 * quote. These tests copy the package sources there and run the commands the
 * tool host client builds from them.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const tempPrefix = path.join(tmpdir(), 'pau-tool-host-');
const temp = realpathSync(mkdtempSync(tempPrefix));
const copy = path.join(temp, "Pau app's copy");
cpSync(path.join(packageDir, 'src'), path.join(copy, 'src'), { recursive: true });
symlinkSync(path.join(packageDir, 'node_modules'), path.join(copy, 'node_modules'));
process.env.PI_CODING_AGENT_DIR = path.join(temp, 'agent');
const clientUrl = pathToFileURL(path.join(copy, 'src/tool-host-client.ts'));
const client = (await import(clientUrl.href)) as typeof import('./tool-host-client.ts');

after(() => rmSync(temp, { recursive: true, force: true }));

test('the ripgrep shim runs the wrapper from a path with a space and a quote', () => {
	const searchPath = path.join(temp, 'search');
	mkdirSync(searchPath);
	writeFileSync(path.join(searchPath, 'rg'), '#!/bin/sh\necho "rg $*"\n', { mode: 0o755 });

	const env = client.prepareAgentDir(path.join(temp, 'session'), `${searchPath}:/usr/bin:/bin`);
	const shim = path.join(env.PI_CODING_AGENT_DIR ?? '', 'bin/rg');
	const result = spawnSync(shim, ['--files', 'a b'], { encoding: 'utf8', env: { ...process.env, ...env } });

	assert.ifError(result.error);
	assert.equal(result.stderr, '');
	assert.equal(result.stdout, 'rg --files a b\n');
	assert.equal(result.status, 0);
});

test('the tool host command starts the host from a path with a space and a quote', async () => {
	const child = spawn('sh', ['-c', client.toolHostCommand()], {
		cwd: temp,
		stdio: ['ignore', 'ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
	const lines = createInterface({ input: child.stdio[3] as Readable });
	const exited = once(child, 'exit');
	try {
		// The channel closes without a line when the host fails to start.
		const [first = ''] = (await Promise.race([once(lines, 'line'), once(lines, 'close')])) as string[];
		assert.equal(stderr, '');
		assert.equal((JSON.parse(first) as { kind: string }).kind, 'ready');
	} finally {
		child.kill('SIGTERM');
		await exited;
	}
});
