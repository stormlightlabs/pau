#!/usr/bin/env node
/**
 * Trusted credential broker process.
 *
 * The supervisor sends real values once over standard input. The broker keeps
 * them in memory for the session and emits only their source names and
 * sentinels. TLS substitution is added by the egress-proxy layer.
 */
import { createInterface } from 'node:readline';

type BrokerCredential = { source: string; sentinel: string; value: string; destinations: string[] };

type StartMessage = { kind: 'start'; credentials: BrokerCredential[] };
type StopMessage = { kind: 'stop' };
type BrokerMessage = StartMessage | StopMessage;

const credentials = new Map<string, BrokerCredential>();
const state = { started: false };

function send(message: unknown): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function clear(): void {
	for (const credential of credentials.values()) {
		credential.value = '';
		credential.destinations.fill('');
	}
	credentials.clear();
}

function fail(message: string): never {
	clear();
	send({ kind: 'error', message });
	process.exit(1);
}

function start(message: StartMessage): void {
	if (state.started) fail('credential broker already started');
	const sentinels = new Set<string>();
	for (const credential of message.credentials) {
		if (!credential.source || !credential.value) fail('credential source and value must be nonempty');
		if (!/^pau_credential_[0-9a-f]{32}$/.test(credential.sentinel)) fail('credential sentinel is invalid');
		if (credentials.has(credential.source)) fail(`credential source ${credential.source} is duplicated`);
		if (sentinels.has(credential.sentinel)) fail('credential sentinel is duplicated');
		sentinels.add(credential.sentinel);
		credentials.set(credential.source, credential);
	}
	state.started = true;
	send({
		kind: 'ready',
		credentials: credentials
			.values()
			.map(({ source, sentinel }) => ({ source, sentinel }))
			.toArray()
	});
}

function stop(): void {
	clear();
	send({ kind: 'stopped' });
	process.exit(0);
}

createInterface({ input: process.stdin }).on('line', (line) => {
	let message: BrokerMessage;
	try {
		message = JSON.parse(line) as BrokerMessage;
	} catch {
		fail('credential broker received invalid JSON');
	}
	if (message.kind === 'start') start(message);
	else if (message.kind === 'stop') stop();
	else fail('credential broker received an unknown message');
});

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.stdin.once('end', stop);
