import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SandboxRuntimeConfigSchema, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import type {
	EffectiveSandbox,
	SandboxAdapter,
	SandboxedMcpServer,
	SandboxPolicyFile,
	SandboxSettings
} from '@stormlightlabs/pau-protocol';
import { credentialRequestFilter } from './credential-proxy.ts';

/** Policy file format this package reads. */
const POLICY_VERSION = 2;

/** A policy file after validation, with a typed runtime configuration. */
export type SandboxPolicy = Omit<SandboxPolicyFile, 'runtimeConfig'> & { runtimeConfig: SandboxRuntimeConfig };

/**
 * Read the policy that Pau resolved for this session. Pau owns the policy in
 * Rust; this package only checks that the file is one it understands and
 * that sandbox-runtime accepts the configuration, and fails closed otherwise.
 */
export function readPolicyFile(file: string): SandboxPolicy {
	const policy = JSON.parse(readFileSync(file, 'utf8')) as SandboxPolicyFile;
	if (policy.version !== POLICY_VERSION) {
		throw new Error(`Unsupported sandbox policy version ${String(policy.version)}`);
	}
	const runtimeConfig = SandboxRuntimeConfigSchema.parse(policy.runtimeConfig);
	if (policy.credentialReferences.length > 0) {
		const references = policy.credentialReferences.map((reference) => ({
			...reference,
			sentinel: policy.environment[reference.source] ?? ''
		}));
		if (references.some((reference) => !reference.sentinel)) {
			throw new Error('Sandbox policy omitted a credential sentinel');
		}
		runtimeConfig.network.filterRequest = credentialRequestFilter(references);
	}
	return { ...policy, runtimeConfig };
}

/** How a policy change reaches a running session. */
export type PolicyChange = 'none' | 'network' | 'restart';

/**
 * Network rules apply to a running sandbox because the host-side proxy
 * enforces them and the tool host passes `NO_PROXY` to each new command.
 * Filesystem rules, the rest of the environment, and MCP servers are fixed
 * when the tool host starts, so any other change needs a restart. Enabling a
 * tool outside the sandbox needs neither.
 */
export function classifyChange(current: SandboxPolicy, next: SandboxPolicy): PolicyChange {
	const network = (policy: SandboxPolicy): string => JSON.stringify([policy.runtimeConfig.network, policy.noProxy]);
	const fixed = (policy: SandboxPolicy): string =>
		JSON.stringify({
			...policy,
			runtimeConfig: { ...policy.runtimeConfig, network: undefined },
			noProxy: undefined,
			unsandboxedTools: undefined
		});
	if (fixed(current) !== fixed(next)) return 'restart';
	return network(current) === network(next) ? 'none' : 'network';
}

/** Request accepted by Pau's `sandbox-policy` resolver. */
export type PolicyRequest = {
	adapter: SandboxAdapter;
	settings: SandboxSettings;
	workspace: string;
	home: string;
	sessionDirectory: string;
	runtimeRoots?: string[];
	toolPath: string;
	/** Contained stdio MCP servers, as an adapter adds them. */
	mcpServers?: SandboxedMcpServer[];
};

/** Output of Pau's `sandbox-policy` resolver. */
export type ResolvedPolicy = {
	policyFile: string;
	policy: SandboxPolicyFile;
	effective: EffectiveSandbox;
	placeholders: string[];
	claudeSettings: unknown;
};

/**
 * Resolve a policy with Pau's Rust resolver, the same code the desktop app
 * uses, and write the policy file. The fixtures use it so they test the
 * policy that Pau launches. Set `PAU_SANDBOX_POLICY_BIN` to a built resolver
 * to skip Cargo.
 */
export function resolvePolicy(request: PolicyRequest, env: NodeJS.ProcessEnv = process.env): ResolvedPolicy {
	const result = spawnSync(resolverBinary(), [], { input: JSON.stringify(request), encoding: 'utf8', env });
	if (result.status !== 0) throw new Error(`sandbox-policy failed: ${result.stderr.trim() || result.error}`);
	return JSON.parse(result.stdout) as ResolvedPolicy;
}

/** The resolver built by Cargo in this process, reused by later calls. */
const built: { resolver?: string } = {};

function resolverBinary(): string {
	if (process.env.PAU_SANDBOX_POLICY_BIN) return process.env.PAU_SANDBOX_POLICY_BIN;
	if (built.resolver) return built.resolver;
	const manifest = fileURLToPath(new URL('../../../Cargo.toml', import.meta.url));
	const build = spawnSync(
		'cargo',
		[
			'build',
			'--quiet',
			'--manifest-path',
			manifest,
			'-p',
			'pau-core',
			'--bin',
			'sandbox-policy',
			'--message-format=json'
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
	);
	const artifact = build.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { reason?: string; executable?: string | null })
		.find((message) => message.reason === 'compiler-artifact' && message.executable);
	if (build.status !== 0 || !artifact?.executable) throw new Error('could not build the sandbox-policy resolver');
	built.resolver = artifact.executable;
	return artifact.executable;
}
