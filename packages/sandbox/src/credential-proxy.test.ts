import assert from 'node:assert/strict';
import test from 'node:test';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import {
	credentialInjectionHost,
	credentialRequestFilter,
	matchesCredentialDestination,
	registerCredentialSubstitution,
	type CredentialProxyReference
} from './credential-proxy.ts';

const sentinel = 'pau_credential_0123456789abcdef0123456789abcdef';
const reference: CredentialProxyReference = {
	source: 'PACKAGE_TOKEN',
	sentinel,
	destinations: ['api.example.com:8443', '*.packages.example.com']
};

test('matches exact, wildcard, and port-scoped TLS destinations', () => {
	assert.equal(
		matchesCredentialDestination(new URL('https://api.example.com:8443/path'), 'api.example.com:8443'),
		true
	);
	assert.equal(matchesCredentialDestination(new URL('https://api.example.com/path'), 'api.example.com:8443'), false);
	assert.equal(
		matchesCredentialDestination(new URL('https://one.packages.example.com/path'), '*.packages.example.com'),
		true
	);
	assert.equal(
		matchesCredentialDestination(new URL('https://packages.example.com/path'), '*.packages.example.com'),
		false
	);
	assert.equal(matchesCredentialDestination(new URL('https://[::1]:4443/path'), '[::1]:4443'), true);
	assert.equal(credentialInjectionHost('api.example.com:8443'), 'api.example.com');
	assert.equal(credentialInjectionHost('[::1]:4443'), '[::1]');
});

test('denies a sentinel on the wrong port and leaves unrelated hosts unchanged', async () => {
	const filter = credentialRequestFilter([reference]);
	const allowed = await filter(
		new Request('https://api.example.com:8443/resource', { headers: { Authorization: `Bearer ${sentinel}` } })
	);
	const wrongPort = await filter(
		new Request('https://api.example.com/resource', { headers: { Authorization: `Bearer ${sentinel}` } })
	);
	const unrelated = await filter(
		new Request('https://other.example.com/resource', { headers: { 'X-Api-Key': sentinel } })
	);
	assert.deepEqual(allowed, { action: 'allow' });
	assert.deepEqual(wrongPort, { action: 'deny', reason: 'credential destination is not permitted' });
	assert.deepEqual(unrelated, { action: 'allow' });
});

test('denies request bodies on an ambiguous port without buffering them', async () => {
	const split = sentinel.indexOf('_0123');
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(Buffer.from(`{"token":"${sentinel.slice(0, split)}`));
			controller.enqueue(Buffer.from(`${sentinel.slice(split)}"}`));
			controller.close();
		}
	});
	const request = new Request('https://api.example.com/token', {
		method: 'POST',
		body,
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
	assert.deepEqual(await credentialRequestFilter([reference])(request), {
		action: 'deny',
		reason: 'credential destination is not permitted'
	});
});

test('never injects through the plaintext request path', async () => {
	// eslint-disable-next-line unicorn/prefer-https -- plaintext is the behavior under test.
	const request = new Request('http://api.example.com:8443/resource', {
		headers: { Authorization: `Bearer ${sentinel}` }
	});
	assert.deepEqual(await credentialRequestFilter([reference])(request), { action: 'allow' });
});

test('substitutes common bearer-token headers only at configured hosts', () => {
	const registry = SandboxManager.getSentinelRegistry();
	registry.clear();
	try {
		for (const value of ['ghp_exampleBearerToken1234567890', 'npm_exampleBearerToken1234567890']) {
			registerCredentialSubstitution([reference], { PACKAGE_TOKEN: value });
			assert.equal(registry.lookupReal(sentinel), value);

			const allowed = { authorization: `Bearer ${sentinel}` };
			registry.substituteInHeaders(allowed, 'api.example.com', (host, pattern) => host === pattern);
			assert.equal(allowed.authorization, `Bearer ${value}`);

			const bodyPairs = registry.sentinelsForHost('api.example.com', (host, pattern) => host === pattern);
			assert.deepEqual(
				bodyPairs.map((pair) => [pair.sentinel.toString(), pair.realValue.toString()]),
				[[sentinel, value]]
			);

			const excluded = { authorization: `Bearer ${sentinel}` };
			registry.substituteInHeaders(excluded, 'other.example.com', (host, pattern) => host === pattern);
			assert.equal(excluded.authorization, `Bearer ${sentinel}`);
			assert.deepEqual(
				registry.sentinelsForHost('other.example.com', (host, pattern) => host === pattern),
				[]
			);
		}
	} finally {
		registry.clear();
	}
});
