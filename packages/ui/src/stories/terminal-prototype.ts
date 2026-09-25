import { ClipboardAddon } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';

export type TerminalPrototypeSocket = Pick<
	WebSocket,
	'binaryType' | 'readyState' | 'send' | 'addEventListener' | 'removeEventListener'
>;

/** The xterm.js pieces exercised by the terminal prototype. */
export type TerminalPrototype = {
	terminal: Terminal;
	fit: () => void;
	findNext: (term: string) => boolean;
	serialize: () => string;
	attach: (socket: TerminalPrototypeSocket) => void;
	detach: () => void;
	dispose: () => void;
};

/**
 * Mounts xterm.js with the official addons needed by Pau and connects its byte
 * stream to a WebSocket. Text frames remain available for control messages.
 */
export function mountTerminalPrototype(element: HTMLElement): TerminalPrototype {
	const terminal = new Terminal({
		allowProposedApi: true,
		convertEol: true,
		cursorBlink: true,
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
		fontSize: 13,
		screenReaderMode: true
	});
	const fitAddon = new FitAddon();
	const searchAddon = new SearchAddon();
	const serializeAddon = new SerializeAddon();
	terminal.loadAddon(fitAddon);
	terminal.loadAddon(searchAddon);
	terminal.loadAddon(serializeAddon);
	terminal.loadAddon(new Unicode11Addon());
	terminal.unicode.activeVersion = '11';
	terminal.loadAddon(new WebLinksAddon((event) => event.preventDefault()));
	terminal.loadAddon(new ClipboardAddon());
	terminal.open(element);

	let socket: TerminalPrototypeSocket | undefined;
	const encoder = new TextEncoder();
	const writeMessage = async (event: MessageEvent) => {
		if (event.data instanceof ArrayBuffer) {
			terminal.write(new Uint8Array(event.data));
		} else if (event.data instanceof Blob) {
			terminal.write(new Uint8Array(await event.data.arrayBuffer()));
		}
	};
	const sendData = terminal.onData((data) => {
		if (socket?.readyState === WebSocket.OPEN) socket.send(encoder.encode(data));
	});
	const sendBinary = terminal.onBinary((data) => {
		if (socket?.readyState !== WebSocket.OPEN) return;
		socket.send(Uint8Array.from(data, (character) => character.codePointAt(0) ?? 0));
	});

	const detach = () => {
		socket?.removeEventListener('message', writeMessage);
		socket = undefined;
	};
	const sendSize = () => {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
		}
	};

	return {
		terminal,
		fit: () => {
			fitAddon.fit();
			sendSize();
		},
		findNext: (term) => searchAddon.findNext(term),
		serialize: () => serializeAddon.serialize(),
		attach: (nextSocket) => {
			detach();
			socket = nextSocket;
			socket.binaryType = 'arraybuffer';
			socket.addEventListener('message', writeMessage);
			sendSize();
		},
		detach,
		dispose: () => {
			detach();
			sendData.dispose();
			sendBinary.dispose();
			terminal.dispose();
		}
	};
}
