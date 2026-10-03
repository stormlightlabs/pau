import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CredentialBroker, type BrokerCredential } from './credential-broker.ts';

function sentinel(): string {
	return `pau_credential_${randomUUID().replaceAll('-', '')}`;
}

function credential(value: string, source = 'PACKAGE_TOKEN'): BrokerCredential {
	return { source, value, sentinel: sentinel(), destinations: ['registry.example.com'] };
}

test('keeps real values in the dedicated process and gives workers only sentinels', async () => {
	const value = `real-value-${randomUUID()}`;
	const entry = credential(value);
	const broker = await CredentialBroker.start([entry]);
	try {
		assert.equal(broker.environment.get(entry.source), entry.sentinel);
		assert.notEqual(broker.environment.get(entry.source), value);

		const observable = JSON.stringify({
			arguments: broker.child.spawnargs,
			workerEnvironment: Object.fromEntries(broker.environment),
			diagnostics: broker.diagnostics
		});
		assert.equal(observable.includes(value), false);

		if (process.platform === 'linux' && broker.processId) {
			const environment = await readFile(`/proc/${broker.processId}/environ`, 'utf8');
			assert.equal(environment.includes(value), false);
			assert.equal(environment.includes(entry.source), false);
		}
	} finally {
		await broker.stop();
	}
});

test('isolates session mappings and clears them on teardown', async () => {
	const value = `real-value-${randomUUID()}`;
	const firstEntry = credential(value);
	const secondEntry = credential(value);
	const first = await CredentialBroker.start([firstEntry]);
	const second = await CredentialBroker.start([secondEntry]);
	try {
		assert.notEqual(first.environment.get('PACKAGE_TOKEN'), second.environment.get('PACKAGE_TOKEN'));
		const firstPid = first.processId;
		await first.stop();
		assert.equal(first.environment.size, 0);
		assert.equal(first.child.exitCode, 0);
		assert.ok(firstPid);
	} finally {
		await first.stop();
		await second.stop();
	}
});

test('rejects duplicate sentinels without printing credential values', async () => {
	const value = `real-value-${randomUUID()}`;
	const shared = sentinel();
	const entries = [
		{ ...credential(value, 'FIRST_TOKEN'), sentinel: shared },
		{ ...credential(value, 'SECOND_TOKEN'), sentinel: shared }
	];
	await assert.rejects(CredentialBroker.start(entries), /credential sentinel is duplicated/);
});
