import path from 'node:path';
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

/** Pau sandbox profiles. */
export type SandboxProfileName = 'workspace-write' | 'read-only';

/**
 * Explicit access added to a profile. Every grant widens the default profile,
 * so the launcher must show it before sandboxed work starts.
 */
export type SandboxGrants = {
	/** Hosts in sandbox-runtime syntax, such as `example.com` or `127.0.0.1:8080`. */
	domains?: string[];
	/** Additional writable roots outside the workspace. */
	writableRoots?: string[];
	/** Linux cannot filter Unix sockets by path, so this grant allows all of them. */
	unixSockets?: boolean;
};

/** Inputs for one effective sandbox policy. */
export type SandboxPolicyInput = {
	profile: SandboxProfileName;
	/** Canonical workspace root. */
	workspace: string;
	/** Dedicated per-session temporary directory. */
	tempDir: string;
	/** Home directory whose credential stores are hidden. */
	home: string;
	grants?: SandboxGrants;
};

/**
 * Credential and authentication stores relative to the home directory. Reads
 * are denied because a readable credential file defeats the network policy as
 * soon as any destination is granted.
 */
export const homeCredentialPaths = [
	'.ssh',
	'.aws',
	'.azure',
	'.gnupg',
	'.kube',
	'.config/gcloud',
	'.config/gh',
	'.docker/config.json',
	'.git-credentials',
	'.netrc',
	'.npmrc',
	'.pypirc',
	'.pi/agent/auth.json',
	'.claude/.credentials.json',
	'.codex/auth.json'
];

/** Workspace files that commonly hold local secrets. */
const workspaceSecretPatterns = ['.env', '.env.local', '.env.*.local'];

/**
 * Repository and agent configuration that a sandboxed tool must not rewrite.
 * sandbox-runtime adds its own mandatory list, but that list does not cover Pi
 * or all Claude settings.
 */
const protectedWorkspacePaths = [
	'.git/hooks',
	'.git/config',
	'.pi',
	'.claude',
	'.codex',
	'.mcp.json',
	'.vscode',
	'.idea'
];

/**
 * Home paths that sandbox-runtime makes writable by default. Pau denies them
 * so the only writable roots are the ones the profile names.
 */
const runtimeConvenienceWrites = ['.npm/_logs', '.claude/debug'];

/**
 * Translate a Pau profile into a sandbox-runtime policy. The result denies all
 * network access unless a grant names a destination, and never widens reads to
 * credential stores.
 */
export function buildRuntimeConfig(input: SandboxPolicyInput): SandboxRuntimeConfig {
	const { workspace, tempDir, home, grants = {} } = input;
	const writable = input.profile === 'workspace-write' ? [workspace, tempDir] : [tempDir];
	return {
		network: {
			allowedDomains: grants.domains ?? [],
			deniedDomains: [],
			allowAllUnixSockets: grants.unixSockets ?? false,
			allowLocalBinding: false
		},
		filesystem: {
			denyRead: [
				...homeCredentialPaths.map((entry) => path.join(home, entry)),
				...workspaceSecretPatterns.map((entry) => path.join(workspace, entry))
			],
			allowRead: [],
			allowWrite: [...writable, ...(grants.writableRoots ?? [])],
			denyWrite: [
				...protectedWorkspacePaths.map((entry) => path.join(workspace, entry)),
				...runtimeConvenienceWrites.map((entry) => path.join(home, entry))
			]
		}
	};
}

/**
 * Build the complete environment for a sandboxed process. Pau starts from an
 * empty environment because sandbox-runtime forwards whatever the caller
 * passes, including provider keys.
 */
export function buildToolEnvironment(input: {
	home: string;
	tempDir: string;
	searchPath: string;
}): Record<string, string> {
	return {
		HOME: input.home,
		LANG: 'C.UTF-8',
		PATH: input.searchPath,
		TERM: 'dumb',
		TMPDIR: input.tempDir,
		PAU_SANDBOX: '1'
	};
}
