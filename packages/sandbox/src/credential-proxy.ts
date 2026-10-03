import { SandboxManager, type FilterRequestCallback } from '@anthropic-ai/sandbox-runtime';
import type { SandboxCredentialReference } from '@stormlightlabs/pau-protocol';

/** One configured credential reference paired with its session sentinel. */
export type CredentialProxyReference = SandboxCredentialReference & { sentinel: string };

type Destination = { host: string; port?: string; wildcard: boolean };

function destination(value: string): Destination {
	let host = value;
	let port: string | undefined;
	if (value.startsWith('[')) {
		const end = value.indexOf(']');
		host = value.slice(1, end);
		port = value.slice(end + 1).replace(/^:/, '') || undefined;
	} else {
		const separator = value.lastIndexOf(':');
		if (separator !== -1 && value.indexOf(':') === separator) {
			host = value.slice(0, separator);
			port = value.slice(separator + 1);
		}
	}
	const wildcard = host.startsWith('*.');
	return { host: (wildcard ? host.slice(2) : host).toLowerCase(), port, wildcard };
}

function requestPort(url: URL): string {
	if (url.port) return url.port;
	return url.protocol === 'https:' ? '443' : '80';
}

function matchesCredentialHost(url: URL, pattern: string): boolean {
	const expected = destination(pattern);
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	return expected.wildcard ? hostname.endsWith(`.${expected.host}`) : hostname === expected.host;
}

/** Return whether a request URL belongs to one configured destination. */
export function matchesCredentialDestination(url: URL, pattern: string): boolean {
	const expected = destination(pattern);
	return matchesCredentialHost(url, pattern) && (expected.port === undefined || expected.port === requestPort(url));
}

/** Remove the optional port before passing an injection host to sandbox-runtime. */
export function credentialInjectionHost(pattern: string): string {
	const parsed = destination(pattern);
	const host = parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host;
	return parsed.wildcard ? `*.${host}` : host;
}

function headerContains(request: Request, sentinels: readonly string[]): boolean {
	for (const [, value] of request.headers) {
		if (sentinels.some((sentinel) => value.includes(sentinel))) return true;
	}
	return false;
}

/**
 * Deny use of a port-scoped sentinel on another port of the same host.
 * sandbox-runtime gates substitution by host, so Pau supplies this stricter
 * request check before its header and body substitution hooks run. A body on
 * an ambiguous host is denied without buffering or inspecting its contents.
 * Plain HTTP is unchanged because the proxy never substitutes on that path.
 */
export function credentialRequestFilter(references: readonly CredentialProxyReference[]): FilterRequestCallback {
	return async (request) => {
		const url = new URL(request.url);
		if (url.protocol !== 'https:') return { action: 'allow' };
		const ambiguous = references.filter(
			(reference) =>
				reference.destinations.some((pattern) => matchesCredentialHost(url, pattern)) &&
				reference.destinations.every((pattern) => !matchesCredentialDestination(url, pattern))
		);
		if (ambiguous.length === 0) return { action: 'allow' };
		if (
			!request.body &&
			!headerContains(
				request,
				ambiguous.map((reference) => reference.sentinel)
			)
		) {
			return { action: 'allow' };
		}
		return { action: 'deny', reason: 'credential destination is not permitted' };
	};
}

/**
 * Register Pau's per-session sentinels with sandbox-runtime's TLS proxy.
 * The real values stay in host memory and are never copied into the policy,
 * tool environment, process arguments, or diagnostics.
 */
export function registerCredentialSubstitution(
	references: readonly CredentialProxyReference[],
	environment: NodeJS.ProcessEnv = process.env
): void {
	const registry = SandboxManager.getSentinelRegistry();
	for (const reference of references) {
		const value = environment[reference.source];
		if (!value) throw new Error(`credential source ${reference.source} is unavailable`);
		registry.registerWithSentinel(
			reference.source,
			reference.sentinel,
			value,
			reference.destinations.map((pattern) => credentialInjectionHost(pattern))
		);
	}
}
