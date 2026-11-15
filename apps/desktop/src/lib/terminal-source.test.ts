import type { TerminalConnectionEvents } from '@stormlightlabs/pau-ui';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createTerminalSource } from './terminal-source';

/** Records the sockets a terminal connection opens and lets a test drive them. */
class FakeSocket extends EventTarget {
	static OPEN = 1;
	static opened: FakeSocket[] = [];
	readyState = 0;
	binaryType = 'blob';
	sent: unknown[] = [];

	constructor(readonly url: string) {
		super();
		FakeSocket.opened.push(this);
	}

	send(data: unknown): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = 3;
	}

	accept(): void {
		this.readyState = FakeSocket.OPEN;
		this.dispatchEvent(new Event('open'));
	}

	receive(text: string): void {
		const data = new TextEncoder().encode(text).buffer;
		this.dispatchEvent(Object.assign(new Event('message'), { data }));
	}

	closeWith(code: number): void {
		this.readyState = 3;
		this.dispatchEvent(Object.assign(new Event('close'), { code }));
	}
}

function info(id: string, workspace: string, program: string) {
	return {
		id,
		workspace_id: workspace,
		command: [program],
		size: { cols: 80, rows: 24 },
		status: { state: 'running' }
	};
}

function events(): TerminalConnectionEvents & { log: string[] } {
	const log: string[] = [];
	return {
		log,
		replay: (bytes) => {
			log.push(`replay ${new TextDecoder().decode(bytes)}`);
		},
		output: (bytes) => {
			log.push(`output ${new TextDecoder().decode(bytes)}`);
		},
		reset: () => {
			log.push('reset');
		},
		exit: () => {
			log.push('exit');
		},
		disconnect: () => {
			log.push('disconnect');
		}
	};
}

beforeEach(() => {
	FakeSocket.opened = [];
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('reconnects a stream that fell behind with a growing delay and clears the screen first', () => {
	const recorded = events();
	createTerminalSource('http://localhost:5173', 'workspace').connect('terminal', recorded);
	FakeSocket.opened[0]!.accept();
	expect(recorded.log).toEqual([]);

	const delays: number[] = [];
	for (let attempt = 0; attempt < 7; attempt += 1) {
		const current = FakeSocket.opened.length;
		FakeSocket.opened.at(-1)!.closeWith(1013);
		let waited = 0;
		while (FakeSocket.opened.length === current) {
			vi.advanceTimersByTime(250);
			waited += 250;
		}
		delays.push(waited);
		FakeSocket.opened.at(-1)!.accept();
	}

	expect(delays).toEqual([250, 500, 1000, 2000, 4000, 8000, 8000]);
	expect(recorded.log).toEqual(Array.from({ length: 7 }, () => 'reset'));
});

test('sends no size on open until the view reports one, then sends that size on each reconnect', () => {
	const connection = createTerminalSource('http://localhost:5173', 'workspace').connect('terminal', events());
	FakeSocket.opened[0]!.accept();
	FakeSocket.opened[0]!.closeWith(1013);
	vi.advanceTimersByTime(250);
	FakeSocket.opened[1]!.accept();
	expect(FakeSocket.opened.map((socket) => socket.sent)).toEqual([[], []]);

	connection.resize(132, 40);
	FakeSocket.opened[1]!.closeWith(1013);
	vi.advanceTimersByTime(500);
	FakeSocket.opened[2]!.accept();
	expect(FakeSocket.opened[2]!.sent).toEqual([JSON.stringify({ type: 'resize', size: { cols: 132, rows: 40 } })]);
});

test('hands each stream its first binary frame as the replay', () => {
	const recorded = events();
	createTerminalSource('http://localhost:5173', 'workspace').connect('terminal', recorded);
	FakeSocket.opened[0]!.accept();
	FakeSocket.opened[0]!.receive('');
	FakeSocket.opened[0]!.receive('live');
	FakeSocket.opened[0]!.closeWith(1013);
	vi.advanceTimersByTime(250);
	FakeSocket.opened[1]!.accept();
	FakeSocket.opened[1]!.receive('live');
	FakeSocket.opened[1]!.receive('more');
	expect(recorded.log).toEqual(['replay ', 'output live', 'reset', 'replay live', 'output more']);
});

test('starts the delay over once a stream stays open', () => {
	createTerminalSource('http://localhost:5173', 'workspace').connect('terminal', events());
	FakeSocket.opened[0]!.accept();
	FakeSocket.opened[0]!.closeWith(1013);
	vi.advanceTimersByTime(250);
	FakeSocket.opened[1]!.accept();
	vi.advanceTimersByTime(10_000);

	FakeSocket.opened[1]!.closeWith(1013);
	vi.advanceTimersByTime(250);
	expect(FakeSocket.opened).toHaveLength(3);
});

test('reports other closes as a lost connection and stops retrying once closed', () => {
	const recorded = events();
	createTerminalSource('http://localhost:5173', 'workspace').connect('terminal', recorded);
	FakeSocket.opened[0]!.closeWith(1006);
	expect(recorded.log).toEqual(['disconnect']);

	const connection = createTerminalSource('http://localhost:5173', 'workspace').connect('terminal', events());
	FakeSocket.opened[1]!.closeWith(1013);
	connection.close();
	vi.advanceTimersByTime(60_000);
	expect(FakeSocket.opened).toHaveLength(2);
});

test('lists the workspace terminals in opening order and numbers repeated programs', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			Response.json([
				info('a', 'workspace', '/bin/zsh'),
				info('b', 'other', '/bin/zsh'),
				info('c', 'workspace', '/usr/bin/nvim'),
				info('d', 'workspace', '/bin/zsh')
			])
		)
	);

	await expect(createTerminalSource('http://localhost:5173', 'workspace').list()).resolves.toEqual([
		{ id: 'a', title: 'zsh' },
		{ id: 'c', title: 'nvim' },
		{ id: 'd', title: 'zsh 2' }
	]);
});

test('opens sandboxed terminals and reports the workspace profile for them', async () => {
	const requests: { url: string; body?: unknown }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			requests.push({ url, body: init?.body && JSON.parse(String(init.body)) });
			if (url.endsWith('/sandbox')) {
				return Response.json({
					selection: { mode: 'sandboxed', settings: { profile: 'read-only' } },
					unavailable: null,
					terminal_unavailable: 'srt was not found'
				});
			}
			return Response.json({ ...info('a', 'workspace', '/bin/zsh'), sandbox: 'read-only' }, { status: 201 });
		})
	);
	const source = createTerminalSource('http://localhost:5173', 'workspace');

	await expect(source.sandbox?.()).resolves.toEqual({ profile: 'read-only', unavailable: 'srt was not found' });
	await expect(source.create({ sandboxed: true })).resolves.toEqual({ id: 'a', title: 'zsh', sandbox: 'read-only' });
	expect(requests.at(-1)?.body).toEqual({
		workspace_id: 'workspace',
		size: { cols: 80, rows: 24 },
		sandboxed: true,
		command: null
	});
});
