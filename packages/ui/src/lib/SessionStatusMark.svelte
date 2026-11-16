<script lang="ts">
	import type { SessionViewModel } from './types/session';
	import '../styles/tokens.css';

	type Props = {
		status: SessionViewModel['status'];
		/** Accessible name for the mark, such as "Running". */
		label: string;
	};

	let { status, label }: Props = $props();
</script>

<!--
	One 8px shape and color per state, from the shared `pau-mark` rules, so the
	state never depends on color alone. Only the running ring moves, and it
	holds still under reduced motion.
-->
<span class={`pau-mark pau-mark--${status}`} data-status={status} role="img" aria-label={label}></span>
