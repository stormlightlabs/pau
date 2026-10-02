import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SandboxProfileName, SandboxSettings } from '@stormlightlabs/pau-protocol';

/** Marker written into every fixture credential. It must never reach tool output. */
export const SECRET = 'pau-sandbox-secret-7d1c';

/**
 * Temporary host layout shared by the boundary matrix and the Pi smoke run.
 * `session` is the Pau-owned session directory; the resolver creates its
 * `tmp` child as the sandbox temporary directory and its `host` child for the
 * policy file.
 */
export type Fixture = {
	root: string;
	workspace: string;
	home: string;
	outside: string;
	session: string;
	tempDir: string;
};

/** Sandbox settings with every optional field at its default. */
export function sandboxSettings(
	profile: SandboxProfileName,
	overrides: Partial<Omit<SandboxSettings, 'profile'>> = {}
): SandboxSettings {
	return {
		profile,
		grants: { domains: [], writable_roots: [], unix_sockets: false },
		home_read_deny: false,
		share_claude_temp: false,
		unsandboxed_tools: [],
		credential_references: [],
		...overrides
	};
}

function put(file: string, content: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

/**
 * Create a workspace, a fake home with credential stores, a directory outside
 * both, and a dedicated temporary directory. The root lives under `/tmp`
 * rather than `os.tmpdir()`: macOS and nix-shell temporary directories are
 * long enough that an MCP relay socket in the session directory would exceed
 * the Unix socket path limit. Paths are canonical because macOS reports
 * `/tmp` through the `/private/tmp` symlink.
 */
export function createFixture(): Fixture {
	const created = mkdtempSync('/tmp/pau-sandbox-');
	const root = realpathSync(created);
	const fixture = {
		root,
		workspace: path.join(root, 'workspace'),
		home: path.join(root, 'home'),
		outside: path.join(root, 'outside'),
		session: path.join(root, 'session'),
		tempDir: path.join(root, 'session/tmp')
	};
	const { workspace, home, outside } = fixture;
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
	put(path.join(home, 'notes.txt'), 'home notes\n');
	put(path.join(outside, 'notes.txt'), 'outside notes\n');
	mkdirSync(path.join(outside, 'granted'), { recursive: true });
	symlinkSync(path.join(home, '.ssh/id_ed25519'), path.join(workspace, 'key-link'));
	symlinkSync(path.join(outside, 'linked.txt'), path.join(workspace, 'outside-link'));
	return fixture;
}
