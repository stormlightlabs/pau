import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Marker written into every fixture credential. It must never reach tool output. */
export const SECRET = 'pau-sandbox-secret-7d1c';

/** Temporary host layout shared by the boundary matrix and the Pi smoke run. */
export type Fixture = { root: string; workspace: string; home: string; outside: string; tempDir: string };

function put(file: string, content: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

/**
 * Create a workspace, a fake home with credential stores, a directory outside
 * both, and a dedicated temporary directory. Paths are canonical because
 * macOS reports `/var` through the `/private/var` symlink.
 */
export function createFixture(): Fixture {
	const created = mkdtempSync(path.join(os.tmpdir(), 'pau-sandbox-'));
	const root = realpathSync(created);
	const fixture = {
		root,
		workspace: path.join(root, 'workspace'),
		home: path.join(root, 'home'),
		outside: path.join(root, 'outside'),
		tempDir: path.join(root, 'tmp')
	};
	const { workspace, home, outside } = fixture;
	mkdirSync(fixture.tempDir, { recursive: true });
	put(path.join(workspace, 'README.md'), 'workspace readme\n');
	put(path.join(workspace, 'AGENTS.md'), 'agent notes\n');
	put(path.join(workspace, 'src/app.ts'), 'export const answer = 41;\n');
	put(path.join(workspace, '.env'), `TOKEN=${SECRET}\n`);
	put(path.join(workspace, '.env.example'), 'TOKEN=\n');
	put(path.join(workspace, '.git/config'), '[core]\n');
	put(path.join(workspace, '.git/hooks/pre-commit'), '#!/bin/sh\n');
	put(path.join(workspace, '.pi/settings.json'), '{}\n');
	for (const file of ['.ssh/id_ed25519', '.aws/credentials']) put(path.join(home, file), `${SECRET}\n`);
	// Pi parses its credential store at startup, so these must be valid JSON.
	for (const file of ['.pi/agent/auth.json', '.claude/.credentials.json']) {
		put(path.join(home, file), `${JSON.stringify({ anthropic: { type: 'api_key', key: SECRET } })}\n`);
	}
	mkdirSync(path.join(home, '.npm/_logs'), { recursive: true });
	put(path.join(outside, 'notes.txt'), 'outside notes\n');
	mkdirSync(path.join(outside, 'granted'), { recursive: true });
	symlinkSync(path.join(home, '.ssh/id_ed25519'), path.join(workspace, 'key-link'));
	symlinkSync(path.join(outside, 'linked.txt'), path.join(workspace, 'outside-link'));
	return fixture;
}
