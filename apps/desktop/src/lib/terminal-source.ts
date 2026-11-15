import type { TerminalInfo, TerminalServerMessage, TerminalSize } from '@stormlightlabs/pau-protocol';
import type { TerminalSource, TerminalTab } from '@stormlightlabs/pau-ui';

import { closeTerminal, createTerminal, getWorkspaceSandbox, listTerminals, resolveTerminalSocket } from './api';

/** Size requested for a new terminal before its view measures the real grid. */
const INITIAL_SIZE = { cols: 80, rows: 24 };

/** Close code the server sends when a stream fell behind the terminal's output. */
const TRY_AGAIN_LATER = 1013;
/** Wait before the first reconnect after a stream fell behind. Each further attempt doubles it. */
const RECONNECT_DELAY_MS = 250;
/** Longest wait between reconnect attempts. */
const MAX_RECONNECT_DELAY_MS = 8000;
/** Time a stream must stay open before the reconnect delay starts over. */
const STABLE_CONNECTION_MS = 10_000;

/**
 * Connects the terminal surface to the loopback API for one workspace. Binary
 * WebSocket frames carry PTY bytes; text frames carry typed control messages.
 *
 * Terminals keep running on the server while no view is attached, so a
 * surface that mounts again lists and reattaches them.
 */
export function createTerminalSource(browserOrigin: string, workspaceId: string): TerminalSource {
	const opened = new Map<string, number>();

	/** Names a terminal after its program, numbering repeats in opening order. */
	function tab(info: TerminalInfo): TerminalTab {
		const program = info.command[0]?.split('/').at(-1) || 'shell';
		const count = (opened.get(program) ?? 0) + 1;
		opened.set(program, count);
		return {
			id: info.id,
			title: count === 1 ? program : `${program} ${count}`,
			...(info.sandbox && { sandbox: info.sandbox })
		};
	}

	return {
		list: async () => {
			const terminals = await listTerminals();
			return terminals.filter((info) => info.workspace_id === workspaceId).map((info) => tab(info));
		},
		create: async (options) =>
			tab(
				await createTerminal({ workspace_id: workspaceId, size: INITIAL_SIZE, sandboxed: options?.sandboxed ?? false })
			),
		sandbox: async () => {
			const { selection, terminal_unavailable } = await getWorkspaceSandbox(workspaceId);
			return {
				profile: selection.mode === 'sandboxed' ? selection.settings.profile : null,
				unavailable: terminal_unavailable
			};
		},
		connect: (id, events) => {
			// Unset until the view measures its grid. A hidden view never does, and
			// sending the creation size on each open would shrink its program.
			let size: TerminalSize | undefined;
			let finished = false;
			let replayed = false;
			let awaitingReplay = false;
			let attempts = 0;
			let retry: ReturnType<typeof setTimeout> | undefined;
			let stable: ReturnType<typeof setTimeout> | undefined;
			let socket: WebSocket;
			const sendSize = () => {
				if (size) socket.send(JSON.stringify({ type: 'resize', size }));
			};

			const open = () => {
				const { url, protocols } = resolveTerminalSocket(browserOrigin, id);
				socket = new WebSocket(url, protocols);
				socket.binaryType = 'arraybuffer';

				socket.addEventListener('open', () => {
					// Every stream starts with the whole scrollback, which the view
					// already shows after the first one.
					if (replayed) events.reset();
					replayed = true;
					awaitingReplay = true;
					sendSize();
					stable = setTimeout(() => (attempts = 0), STABLE_CONNECTION_MS);
				});
				socket.addEventListener('message', (event: MessageEvent<ArrayBuffer | string>) => {
					if (typeof event.data !== 'string') {
						// The first binary frame is always the scrollback, even when empty.
						if (awaitingReplay) events.replay(new Uint8Array(event.data));
						else events.output(new Uint8Array(event.data));
						awaitingReplay = false;
						return;
					}
					const message = JSON.parse(event.data) as TerminalServerMessage;
					if (!(message.type === 'exited' && message.status.state === 'exited')) {
						return;
					}

					finished = true;
					events.exit({ exitCode: message.status.exit_code, signal: message.status.signal });
				});
				socket.addEventListener('close', (event) => {
					clearTimeout(stable);
					if (finished) return;
					// Output that keeps outrunning the link makes each new stream
					// fall behind again, so the wait grows with every attempt.
					if (event.code === TRY_AGAIN_LATER) {
						retry = setTimeout(open, Math.min(RECONNECT_DELAY_MS * 2 ** attempts, MAX_RECONNECT_DELAY_MS));
						attempts += 1;
						return;
					}
					events.disconnect();
				});
			};
			open();

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
					clearTimeout(retry);
					clearTimeout(stable);
					socket.close();
				}
			};
		},
		close: async (id) => {
			await closeTerminal(id);
		}
	};
}
