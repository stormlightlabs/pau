import type { ServerStreamMessage } from '@stormlightlabs/pau-protocol';

import type { EventSocket } from './event-stream';

/** In-memory event socket that tests drive message by message. */
export class FakeEventSocket implements EventSocket {
	#openListener: (() => void) | undefined;
	#messageListener: ((event: MessageEvent<string>) => void) | undefined;
	#closeListener: (() => void) | undefined;
	closed = false;

	constructor(readonly url: string) {}

	addEventListener(
		type: 'open' | 'message' | 'close',
		listener: ((event: MessageEvent<string>) => void) | (() => void)
	): void {
		if (type === 'open') this.#openListener = listener as () => void;
		else if (type === 'message') this.#messageListener = listener as (event: MessageEvent<string>) => void;
		else this.#closeListener = listener as () => void;
	}

	close(): void {
		this.closed = true;
	}

	open(): void {
		this.#openListener?.();
	}

	receive(value: ServerStreamMessage): void {
		this.#messageListener?.({ data: JSON.stringify(value) } as MessageEvent<string>);
	}

	disconnect(): void {
		this.#closeListener?.();
	}
}
