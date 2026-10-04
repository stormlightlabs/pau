import assert from 'node:assert/strict';
import test from 'node:test';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { createSigv4Planner } from '@anthropic-ai/sandbox-runtime/dist/sandbox/credential-aws-pairs.js';
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
	shape: 'whole-value',
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

test('a permitted destination can reflect a substituted credential to the sandboxed caller', async () => {
	const registry = SandboxManager.getSentinelRegistry();
	registry.clear();
	try {
		const value = 'reflected-example-token';
		registerCredentialSubstitution([reference], { PACKAGE_TOKEN: value });
		const forwarded = { authorization: `Bearer ${sentinel}` };
		registry.substituteInHeaders(forwarded, 'api.example.com', (host, pattern) => host === pattern);

		// The egress proxy controls where substitution happens. It cannot control
		// what an authorized service does with the credential after receiving it.
		const response = new Response(forwarded.authorization);
		assert.equal(await response.text(), `Bearer ${value}`);
	} finally {
		registry.clear();
	}
});

test('extracts URL passwords and colon-pair credentials without exposing the complete value', () => {
	const registry = SandboxManager.getSentinelRegistry();
	registry.clear();
	try {
		const urlReference = { ...reference, source: 'DATABASE_URL', shape: 'url-password' as const };
		const pairSentinel = 'pau_credential_33333333333333333333333333333333';
		const pairReference = {
			...reference,
			source: 'REGISTRY_AUTH',
			shape: 'colon-pair' as const,
			sentinel: pairSentinel
		};
		const environment = registerCredentialSubstitution([urlReference, pairReference], {
			DATABASE_URL: 'postgresql://builder:p%40ssword@database.example.com/app?sslmode=require',
			REGISTRY_AUTH: 'builder:token:with:colons'
		});

		assert.equal(environment.DATABASE_URL, `postgresql://builder:${sentinel}@database.example.com/app?sslmode=require`);
		assert.equal(environment.REGISTRY_AUTH, `builder:${pairSentinel}`);
		assert.equal(registry.lookupReal(sentinel), 'p@ssword');
		assert.equal(registry.lookupReal(pairSentinel), 'token:with:colons');
	} finally {
		registry.clear();
	}
});

test('rejects structured mismatches and unknown shapes before registering any value', () => {
	const registry = SandboxManager.getSentinelRegistry();
	registry.clear();
	const structured = { ...reference, source: 'DATABASE_URL', shape: 'url-password' as const };
	assert.throws(
		() => registerCredentialSubstitution([structured], { DATABASE_URL: 'not-a-url' }),
		/does not match the selected url-password shape/
	);
	assert.equal(registry.size, 0);
	assert.throws(
		() =>
			registerCredentialSubstitution([{ ...reference, shape: 'future-shape' } as unknown as CredentialProxyReference], {
				PACKAGE_TOKEN: 'secret'
			}),
		/unknown credential shape/
	);
	assert.equal(registry.size, 0);
});

test('registers conventional whole-value AWS credentials for SigV4 re-signing', () => {
	const registry = SandboxManager.getSentinelRegistry();
	const awsRegistry = SandboxManager.getAwsPairRegistry();
	registry.clear();
	awsRegistry.clear();
	const accessSentinel = 'pau_credential_11111111111111111111111111111111';
	const secretSentinel = 'pau_credential_22222222222222222222222222222222';
	try {
		registerCredentialSubstitution(
			[
				{ ...reference, source: 'AWS_ACCESS_KEY_ID', sentinel: accessSentinel },
				{ ...reference, source: 'AWS_SECRET_ACCESS_KEY', sentinel: secretSentinel }
			],
			{ AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'aws-secret-example' }
		);
		assert.deepEqual(awsRegistry.lookup(accessSentinel), {
			accessKeyIdSentinel: accessSentinel,
			realAccessKeyId: 'AKIAEXAMPLE',
			realSecretAccessKey: 'aws-secret-example',
			injectHosts: ['api.example.com', '*.packages.example.com']
		});

		const planner = createSigv4Planner(awsRegistry, undefined, (host, pattern) => host === pattern);
		const authorization =
			`AWS4-HMAC-SHA256 Credential=${accessSentinel}/20261003/us-east-1/service/aws4_request, ` +
			`SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${'0'.repeat(64)}`;
		const headers = { authorization, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': '20261003T120000Z' };
		const plan = planner('GET', '/resource', headers, 'api.example.com');
		assert.equal(plan?.action, 'resign');
		if (plan?.action !== 'resign') throw new Error('expected SigV4 re-signing');
		const forwarded = { ...headers };
		plan.apply(forwarded, 'api.example.com', 'UNSIGNED-PAYLOAD');
		assert.match(forwarded.authorization, /Credential=AKIAEXAMPLE\//);
		assert.doesNotMatch(forwarded.authorization, new RegExp(accessSentinel));
		assert.equal(planner('GET', '/resource', headers, 'other.example.com'), undefined);

		const streaming = planner(
			'PUT',
			'/resource',
			{ ...headers, 'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD' },
			'api.example.com'
		);
		assert.equal(streaming?.action, 'deny');
	} finally {
		registry.clear();
		awsRegistry.clear();
	}
});
