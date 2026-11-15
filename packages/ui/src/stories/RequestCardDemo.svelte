<script lang="ts">
	import '../styles/tokens.css';

	type Props = {
		/** The transcript column's width. */
		width?: string;
		/** The question, with a path in the code face. */
		path?: string;
		/** Disables the actions with a reason, as while Pau reconnects. */
		reconnecting?: boolean;
	};

	let { width = '44rem', path = 'crates/server/src/sessions.rs', reconnecting = false }: Props = $props();
	const reasonId = $props.id();
	let answer = $state<string>();
</script>

<!--
	The request card: the one green surface on a view. Allow once is the
	primary; the other actions are secondary, each with its key cap.
-->
<div class="request-demo" style:max-width={width}>
	<section class="pau-request" aria-labelledby="request-demo-title">
		<div class="pau-request__head">
			<span class="pau-mark pau-mark--waiting" aria-hidden="true"></span>
			<h2 class="pau-request__title" id="request-demo-title">Allow write to <code>{path}</code>?</h2>
		</div>
		<p class="pau-request__body">
			Pi wants to apply its second edit to this file. It adds the ready wait and the failed start.
		</p>
		<div class="pau-request__actions">
			{#each [['Allow once', 'Y', 'primary'], ['Allow for session', 'A', 'secondary'], ['Deny', 'N', 'secondary']] as [label, key, variant] (label)}
				<button
					type="button"
					class={`pau-button pau-button--${variant}`}
					disabled={reconnecting}
					aria-describedby={reconnecting ? reasonId : undefined}
					onclick={() => (answer = label)}><span>{label}</span><kbd><span>{key}</span></kbd></button>
			{/each}
			<span class="pau-request__aside" id={reasonId}
				>{reconnecting ? 'Reconnecting to Pau…' : answer ? `${answer} sent` : 'Asked 4m ago'}</span>
		</div>
	</section>
</div>

<style>
	.request-demo {
		padding: var(--pau-space-5);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}
</style>
