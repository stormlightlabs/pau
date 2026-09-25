import { expect, test } from 'vitest';

import { mountTerminalPrototype } from '../stories/terminalPrototype';

class FakeSocket extends EventTarget {
	binaryType: BinaryType = 'blob';
	readonly readyState = WebSocket.OPEN;
	readonly sent: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
		this.sent.push(data);
	}

	message(bytes: Uint8Array) {
		this.dispatchEvent(new MessageEvent('message', { data: bytes.buffer }));
	}
}

const settleWrites = () => new Promise((resolve) => setTimeout(resolve, 20));

test('carries terminal bytes and control messages across reconnects', async () => {
	const host = document.createElement('div');
	host.style.width = '800px';
	host.style.height = '400px';
	document.body.append(host);
	const prototype = mountTerminalPrototype(host);
	const first = new FakeSocket();

	prototype.attach(first);
	prototype.fit();
	prototype.terminal.input('printf "界 🙂"\r');
	first.message(new TextEncoder().encode('shell output: 界 🙂\r\n'));
	await settleWrites();

	expect(first.binaryType).toBe('arraybuffer');
	expect(first.sent.some((message) => typeof message === 'string' && message.includes('"resize"'))).toBe(true);
	expect(
		first.sent.some((message) => message instanceof Uint8Array && new TextDecoder().decode(message).includes('界'))
	).toBe(true);
	expect(prototype.serialize()).toContain('shell output: 界 🙂');
	expect(prototype.findNext('shell output')).toBe(true);
	expect(prototype.terminal.unicode.activeVersion).toBe('11');

	const second = new FakeSocket();
	prototype.attach(second);
	prototype.terminal.input('echo reconnected\r');

	expect(second.sent.some((message) => message instanceof Uint8Array)).toBe(true);
	expect(first.sent.filter((message) => message instanceof Uint8Array)).toHaveLength(1);

	prototype.dispose();
	host.remove();
});
