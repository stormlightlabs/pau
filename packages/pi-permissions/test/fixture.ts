/**
 * A temporary workspace, fake home, and outside directory for gate tests and
 * Pi fixture runs, plus a policy file shaped like the one Pau writes.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Marker written into every fixture credential. It must never reach a tool result. */
export const SECRET = 'pau-permissions-secret-41c9';

export type Fixture = { root: string; workspace: string; home: string; outside: string; policyFile: string };

/** A policy rule as written to the policy file. */
export type FileRule = {
	source: 'protected' | 'user' | 'project';
	surface: 'tool' | 'bash' | 'read' | 'write' | 'path';
	pattern: string;
	action: 'allow' | 'ask' | 'deny';
	reason?: string;
};

function put(file: string, content: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

export function createFixture(): Fixture {
	const created = mkdtempSync(path.join(tmpdir(), 'pau-permissions-'));
	const root = realpathSync(created);
	const fixture = {
		root,
		workspace: path.join(root, 'workspace'),
		home: path.join(root, 'home'),
		outside: path.join(root, 'outside'),
		policyFile: path.join(root, 'host', 'permissions.json')
	};
	const { workspace, home, outside } = fixture;
	put(path.join(workspace, 'README.md'), 'workspace readme\n');
	put(path.join(workspace, '.env'), `TOKEN=${SECRET}\n`);
	put(path.join(workspace, '.env.example'), 'TOKEN=\n');
	put(path.join(home, '.ssh/id_ed25519'), `${SECRET}\n`);
	put(path.join(outside, 'notes.txt'), 'outside notes\n');
	put(path.join(outside, 'other/notes.txt'), 'other notes\n');
	// Pi parses its credential store at startup, so it must be valid JSON.
	put(path.join(home, '.pi/agent/auth.json'), '{}\n');
	symlinkSync(path.join(home, '.ssh/id_ed25519'), path.join(workspace, 'key-link'));
	mkdirSync(path.dirname(fixture.policyFile), { recursive: true });
	return fixture;
}

/** The protected-path rules Pau writes for the fixture's home and workspace. */
export function protectedRules({ home, workspace, policyFile }: Fixture): FileRule[] {
	const deny = (pattern: string): FileRule => ({ source: 'protected', surface: 'path', pattern, action: 'deny' });
	return [
		deny(path.join(home, '.ssh')),
		deny(path.join(home, '.ssh/*')),
		deny(path.join(home, '.pi/agent/auth.json')),
		deny(path.join(workspace, '.env')),
		deny(path.dirname(policyFile)),
		deny(path.join(path.dirname(policyFile), '*'))
	];
}

/** Write a policy file and return its path. */
export function writePolicy(
	fixture: Fixture,
	options: { profile?: string; rules?: FileRule[]; dialogTimeoutMs?: number } = {}
): string {
	const policy = {
		version: 1,
		profile: options.profile ?? 'confirm-mutating',
		workspace: fixture.workspace,
		dialogTimeoutMs: options.dialogTimeoutMs ?? 300_000,
		rules: [...protectedRules(fixture), ...(options.rules ?? [])]
	};
	writeFileSync(fixture.policyFile, JSON.stringify(policy), { mode: 0o600 });
	return fixture.policyFile;
}
