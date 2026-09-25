<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import { onMount } from 'svelte';

	import { mountTerminalPrototype, type TerminalPrototype } from './terminal-prototype';

	let { endpoint }: { endpoint?: string } = $props();
	let host: HTMLDivElement;
	let prototype: TerminalPrototype | undefined;
	let socket: WebSocket | undefined;
	let status = $state('Fixture ready');

	const fixture = new TextEncoder().encode(
		'\u{1B}[1;34m~/pau\u{1B}[0m $ printf "Terminal ready: 界 🙂"\r\nTerminal ready: 界 🙂\r\n'
	);

	function replayFixture() {
		prototype?.terminal.write(fixture);
		status = 'Fixture replayed';
	}

	function connect() {
		if (!endpoint || !prototype) return;
		socket?.close();
		status = 'Connecting';
		socket = new WebSocket(endpoint);
		socket.addEventListener('open', () => {
			prototype?.attach(socket!);
			prototype?.fit();
			prototype?.terminal.focus();
			status = 'Connected';
		});
		socket.addEventListener('close', () => {
			prototype?.detach();
			status = 'Disconnected';
		});
		socket.addEventListener('error', () => {
			status = 'Connection failed';
		});
	}

	onMount(() => {
		prototype = mountTerminalPrototype(host);
		const observer = new ResizeObserver(() => prototype?.fit());
		observer.observe(host);
		requestAnimationFrame(() => prototype?.fit());
		if (endpoint) {
			status = 'Disconnected';
			connect();
		} else replayFixture();

		return () => {
			observer.disconnect();
			socket?.close();
			prototype?.dispose();
		};
	});
</script>

<section aria-label="Terminal prototype">
	<header>
		<div>
			<h1>Terminal prototype</h1>
			<p role="status">{status}</p>
		</div>
		{#if endpoint}
			<button type="button" onclick={connect}>Reconnect</button>
		{:else}
			<button type="button" onclick={replayFixture}>Replay fixture</button>
		{/if}
	</header>
	<div class="terminal" bind:this={host}></div>
</section>

<style>
	section {
		width: min(64rem, calc(100vw - 2rem));
		padding: 0.75rem;
		color: var(--pau-text, #e5e7ef);
		background: var(--pau-surface, #171921);
		border: 1px solid var(--pau-border, #353951);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		font-size: 0.85rem;
		font-weight: 600;
	}

	p {
		margin-top: 0.15rem;
		color: var(--pau-text-muted, #a9a8c0);
		font-size: 0.75rem;
	}

	button {
		min-height: 2rem;
		padding-inline: 0.75rem;
		color: inherit;
		background: transparent;
		border: 1px solid var(--pau-border, #51566f);
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--pau-focus, #8bd7ff);
		outline-offset: 2px;
	}

	.terminal {
		height: min(32rem, calc(100vh - 10rem));
		min-height: 20rem;
		padding: 0.5rem;
		background: #101218;
	}
</style>
