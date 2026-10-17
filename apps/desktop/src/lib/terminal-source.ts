import type { TerminalServerMessage } from '@stormlightlabs/pau-protocol';
import type { TerminalSource } from '@stormlightlabs/pau-ui';

import { closeTerminal, createTerminal, resolveTerminalSocket } from './api';

/** Size requested for a new terminal before its view measures the real grid. */
const INITIAL_SIZE = { cols: 80, rows: 24 };

/**
 * Connects the terminal surface to the loopback API for one workspace. Binary
 * WebSocket frames carry PTY bytes; text frames carry typed control messages.
 */
export function createTerminalSource(browserOrigin: string, workspaceId: string): TerminalSource {
	const opened = new Map<string, number>();

	return {
		create: async () => {
			const info = await createTerminal(workspaceId, INITIAL_SIZE);
			const program = info.command[0]?.split('/').at(-1) || 'shell';
			const count = (opened.get(program) ?? 0) + 1;
			opened.set(program, count);
			return { id: info.id, title: count === 1 ? program : `${program} ${count}` };
		},
		connect: (id, events) => {
			const { url, protocols } = resolveTerminalSocket(browserOrigin, id);
			const socket = new WebSocket(url, protocols);
			socket.binaryType = 'arraybuffer';
			let size = INITIAL_SIZE;
			let finished = false;
			const sendSize = () => socket.send(JSON.stringify({ type: 'resize', size }));

			socket.addEventListener('open', sendSize);
			socket.addEventListener('message', (event: MessageEvent<ArrayBuffer | string>) => {
				if (typeof event.data !== 'string') {
					events.output(new Uint8Array(event.data));
					return;
				}
				const message = JSON.parse(event.data) as TerminalServerMessage;
				if (!(message.type === 'exited' && message.status.state === 'exited')) {
					return;
				}

				finished = true;
				events.exit({ exitCode: message.status.exit_code, signal: message.status.signal });
			});
			socket.addEventListener('close', () => {
				if (!finished) events.disconnect();
			});

			return {
				write: (bytes) => {
					if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
				},
				resize: (cols, rows) => {
					size = { cols, rows };
					if (socket.readyState === WebSocket.OPEN) sendSize();
				},
				close: () => {
					// A view that unmounts on purpose is not a lost connection.
					finished = true;
					socket.close();
				}
			};
		},
		close: async (id) => {
			await closeTerminal(id);
		}
	};
}
