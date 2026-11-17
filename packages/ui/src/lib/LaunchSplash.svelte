<!--
@component
Covers the window while Pau starts and shows the app once launch is ready.

It names the step in progress and marks the steps already done, without a
percentage, because launch cannot measure how far along a step is. When launch
stops, it shows the step that failed, why, and what to do next, with a way to
copy those details. When `phase` becomes `ready`, the app renders at once and
the splash fades out over it, or disappears instantly under reduced motion.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import '../styles/tokens.css';
	import { isReducedMotion, motion } from '../motion';
	import { themeCssProperties, type ThemeName, type UiFontName } from '../theme';
	import CopyButton from './CopyButton.svelte';
	import type { LaunchAction, LaunchPhase, LaunchStep, LaunchStepState } from './types/launch';

	type Props = {
		phase: LaunchPhase;
		/** Every launch step, in the order launch runs them. */
		steps: LaunchStep[];
		/** Why launch could not be followed at all, when no step reports a failure. */
		error?: string;
		/** The app, rendered once `phase` is `ready`. */
		children?: Snippet;
		theme?: ThemeName;
		uiFont?: UiFontName;
	};

	let { phase, steps, error, children, theme = 'eldritch', uiFont = 'overpass' }: Props = $props();

	/** Next steps for a failure that stops launch. Pi actions appear in the app instead. */
	const actionText: Partial<Record<LaunchAction, string>> = {
		update_pau: 'This data comes from a newer version of Pau. Install that version to open it.'
	};

	const stateText: Record<LaunchStepState, string> = {
		pending: 'Waiting',
		running: 'In progress',
		done: 'Done',
		failed: 'Failed'
	};

	const failed = $derived(phase === 'failed');
	/** The failure that stopped launch. Earlier failed steps, such as a slow PATH, let launch continue. */
	const stoppedAt = $derived(failed ? steps.findLast((step) => step.state === 'failed') : undefined);
	const currentIndex = $derived.by(() => {
		const running = steps.findIndex((step) => step.state === 'running');
		if (running !== -1) return running;
		const pending = steps.findIndex((step) => step.state === 'pending');
		return pending !== -1 ? pending : steps.length - 1;
	});
	const current = $derived(steps.at(currentIndex));
	const action = $derived(stoppedAt?.action ? actionText[stoppedAt.action] : undefined);
	const style = $derived(
		Object.entries(themeCssProperties(theme, uiFont))
			.map(([property, value]) => `${property}: ${value}`)
			.join('; ')
	);

	function describe(step: LaunchStep): string {
		if (step !== stoppedAt && step.state === 'failed') return 'Needs attention';
		return stateText[step.state];
	}

	/** Plain text for a bug report or a search, read when the operator copies it. */
	const details = $derived(
		[
			'Pau could not start.',
			...steps.map((step) => `${step.label}: ${describe(step)}${step.reason ? `\n  ${step.reason}` : ''}`),
			error,
			action
		]
			.filter(Boolean)
			.join('\n')
	);

	/** Fades the splash over the app. Reduced motion removes it at once. */
	function leave(node: Element) {
		return fade(node, { duration: isReducedMotion() ? 0 : motion.duration.quick });
	}
</script>

{#if phase === 'ready'}
	{@render children?.()}
{:else}
	<main class="launch-splash" aria-busy={!failed} data-theme={theme} {style} out:leave>
		<div class="launch-splash__content">
			<div class="launch-splash__brand">
				<svg class="launch-splash__mark" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
					<path d="M9.5 6.5H41A13.5 13.5 0 0 1 41 33.5H23.5V26.5H41A6.5 6.5 0 0 0 41 13.5H9.5Z" />
					<path d="M23.5 6.5V48A9.5 9.5 0 0 0 33 57.5H38.5V50.5H33A2.5 2.5 0 0 1 30.5 48V6.5Z" />
				</svg>
				<div>
					<strong>Pau</strong>
					<span>Local coding workspace</span>
				</div>
			</div>

			<div class="launch-splash__current" aria-live="polite">
				{#if failed}
					<p class="launch-splash__eyebrow launch-splash__eyebrow--failed">Launch stopped</p>
					<h1>Pau could not start</h1>
				{:else if current}
					<p class="launch-splash__eyebrow">Launch {currentIndex + 1} / {steps.length}</p>
					<h1>{current.label}</h1>
				{:else}
					<p class="launch-splash__eyebrow">Launch</p>
					<h1>Starting Pau</h1>
				{/if}
			</div>

			{#if steps.length > 0}
				<ol class="launch-splash__steps" aria-label="Launch steps">
					{#each steps as step (step.id)}
						{@const attention = step.state === 'failed' && step !== stoppedAt}
						<li
							class={['launch-splash__step', `launch-splash__step--${attention ? 'attention' : step.state}`]}
							aria-current={!failed && current === step ? 'step' : undefined}>
							<svg
								class="launch-splash__step-mark"
								viewBox="0 0 12 12"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true">
								{#if step.state === 'done'}
									<path d="M2.5 6.5 5 9l4.5-6" />
								{:else if step.state === 'running'}
									<circle cx="6" cy="6" r="4" opacity="0.3" />
									<path d="M6 2a4 4 0 0 1 4 4" />
								{:else if attention}
									<path d="M6 2.5v4.5M6 9.5v0" />
								{:else if step.state === 'failed'}
									<path d="M3 3l6 6M9 3l-6 6" />
								{:else}
									<circle cx="6" cy="6" r="3.5" />
								{/if}
							</svg>
							<span class="launch-splash__step-label">{step.label}</span>
							<span class="launch-splash__step-state">{describe(step)}</span>
							{#if step.reason}
								<p class="launch-splash__reason">{step.reason}</p>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}

			{#if failed}
				<div class="launch-splash__failure" role="alert">
					{#if error}<p>{error}</p>{/if}
					{#if action}<p>{action}</p>{/if}
				</div>
				<div class="launch-splash__actions">
					<CopyButton text={details} label="Copy details" />
				</div>
			{/if}
		</div>
	</main>
{/if}

<style>
	.launch-splash {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: grid;
		place-items: center;
		overflow: auto;
		padding: var(--pau-space-6) var(--pau-space-4);
		color: var(--pau-text);
		background: var(--pau-canvas);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		line-height: 1.4;
	}

	.launch-splash__content {
		inline-size: min(28rem, 100%);
	}

	.launch-splash__brand {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		padding-block-end: var(--pau-space-6);
	}

	.launch-splash__mark {
		flex: none;
		inline-size: 1.75rem;
		block-size: 1.75rem;
		color: var(--pau-accent);
	}

	.launch-splash__brand strong {
		display: block;
		font-size: var(--pau-type-lg);
		font-weight: var(--pau-weight-semibold);
	}

	.launch-splash__brand span {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.launch-splash__current p,
	.launch-splash__current h1,
	.launch-splash__failure p {
		margin: 0;
	}

	.launch-splash__eyebrow {
		padding-block-end: var(--pau-space-2);
		color: var(--pau-accent);
		font-size: var(--pau-type-label);
		font-weight: var(--pau-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.launch-splash__eyebrow--failed {
		color: var(--pau-danger);
	}

	.launch-splash__current h1 {
		font-size: var(--pau-type-xl);
		font-weight: var(--pau-weight-semibold);
	}

	.launch-splash__steps {
		display: grid;
		gap: var(--pau-space-2);
		margin: var(--pau-space-5) 0 0;
		padding: var(--pau-space-4) 0 0;
		list-style: none;
		border-block-start: 1px solid var(--pau-border);
	}

	.launch-splash__step {
		display: grid;
		grid-template-columns: 0.75rem minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--pau-space-2);
		color: var(--pau-text-muted);
	}

	.launch-splash__step--running,
	.launch-splash__step--failed {
		color: var(--pau-text);
	}

	.launch-splash__step-mark {
		inline-size: 0.75rem;
		block-size: 0.75rem;
	}

	.launch-splash__step--done .launch-splash__step-mark {
		color: var(--pau-success);
	}

	.launch-splash__step--running .launch-splash__step-mark {
		color: var(--pau-accent);
		animation: launch-splash-spin 0.9s linear infinite;
	}

	.launch-splash__step--attention .launch-splash__step-mark {
		color: var(--pau-warning);
	}

	.launch-splash__step--failed .launch-splash__step-mark {
		color: var(--pau-danger);
	}

	.launch-splash__step-state {
		font-size: var(--pau-type-xs);
	}

	.launch-splash__reason {
		grid-column: 2 / -1;
		margin: var(--pau-space-1) 0 0;
		color: var(--pau-text);
		font-size: var(--pau-type-sm);
		overflow-wrap: anywhere;
	}

	.launch-splash__failure {
		display: grid;
		gap: var(--pau-space-2);
		margin-block-start: var(--pau-space-4);
	}

	.launch-splash__failure:empty {
		display: none;
	}

	.launch-splash__actions {
		margin-block-start: var(--pau-space-4);
	}

	@keyframes launch-splash-spin {
		to {
			transform: rotate(360deg);
		}
	}

	:global(:root[data-motion='reduce']) .launch-splash__step--running .launch-splash__step-mark {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .launch-splash__step--running .launch-splash__step-mark {
			animation: none;
		}
	}
</style>
