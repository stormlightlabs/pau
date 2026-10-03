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
): Record<string, string> {
	const prepared = references.map((reference) => prepareCredential(reference, environment[reference.source]));
	const registry = SandboxManager.getSentinelRegistry();
	for (const { reference, realValue } of prepared) {
		registry.registerWithSentinel(
			reference.source,
			reference.sentinel,
			realValue,
			reference.destinations.map((pattern) => credentialInjectionHost(pattern))
		);
	}
	registerAwsSigv4Pair(prepared, environment);
	return Object.fromEntries(prepared.map(({ reference, sandboxValue }) => [reference.source, sandboxValue]));
}

type PreparedCredential = { reference: CredentialProxyReference; realValue: string; sandboxValue: string };

function prepareCredential(reference: CredentialProxyReference, value: string | undefined): PreparedCredential {
	if (!value) throw new Error(`credential source ${reference.source} is unavailable`);
	switch (reference.shape) {
		case 'whole-value': {
			return { reference, realValue: value, sandboxValue: reference.sentinel };
		}
		case 'url-password': {
			const schemeEnd = value.indexOf('://');
			const scheme = value.slice(0, schemeEnd);
			if (!/^[A-Za-z][A-Za-z\d+.-]*$/.test(scheme)) throw shapeMismatch(reference);
			const authorityStart = schemeEnd + 3;
			const authorityEnd = value.slice(authorityStart).search(/[/?#]/);
			const end = authorityEnd === -1 ? value.length : authorityStart + authorityEnd;
			const at = value.lastIndexOf('@', end - 1);
			const colon = value.indexOf(':', authorityStart);
			if (schemeEnd <= 0 || colon < authorityStart || colon >= at || at >= end) {
				throw shapeMismatch(reference);
			}
			const encoded = value.slice(colon + 1, at);
			if (!encoded || !value.slice(authorityStart, colon) || !value.slice(at + 1, end)) throw shapeMismatch(reference);
			let decoded: string;
			try {
				decoded = decodeURIComponent(encoded);
			} catch {
				throw shapeMismatch(reference);
			}
			if (!decoded) throw shapeMismatch(reference);
			return {
				reference,
				realValue: decoded,
				sandboxValue: `${value.slice(0, colon + 1)}${reference.sentinel}${value.slice(at)}`
			};
		}
		case 'colon-pair': {
			const separator = value.indexOf(':');
			if (separator <= 0 || separator === value.length - 1) throw shapeMismatch(reference);
			return {
				reference,
				realValue: value.slice(separator + 1),
				sandboxValue: `${value.slice(0, separator + 1)}${reference.sentinel}`
			};
		}
		default: {
			throw new Error(`credential source ${reference.source} has an unknown credential shape`);
		}
	}
}

function shapeMismatch(reference: CredentialProxyReference): Error {
	return new Error(`credential source ${reference.source} does not match the selected ${reference.shape} shape`);
}

function registerAwsSigv4Pair(prepared: readonly PreparedCredential[], environment: NodeJS.ProcessEnv): void {
	const bySource = new Map(prepared.map((credential) => [credential.reference.source, credential]));
	const accessKey = bySource.get('AWS_ACCESS_KEY_ID');
	const secretKey = bySource.get('AWS_SECRET_ACCESS_KEY');
	if (accessKey?.reference.shape !== 'whole-value' || secretKey?.reference.shape !== 'whole-value') return;
	const sessionToken = bySource.get('AWS_SESSION_TOKEN');
	const realAccessKey = environment.AWS_ACCESS_KEY_ID;
	const realSecretKey = environment.AWS_SECRET_ACCESS_KEY;
	if (!realAccessKey || !realSecretKey) return;
	SandboxManager.getAwsPairRegistry().register({
		accessKeyIdSentinel: accessKey.reference.sentinel,
		realAccessKeyId: realAccessKey,
		realSecretAccessKey: realSecretKey,
		...(sessionToken?.reference.shape === 'whole-value' &&
			environment.AWS_SESSION_TOKEN && { realSessionToken: environment.AWS_SESSION_TOKEN }),
		injectHosts: accessKey.reference.destinations.map((pattern) => credentialInjectionHost(pattern))
	});
}
