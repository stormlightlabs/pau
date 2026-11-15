<script lang="ts">
	import { THEMES, type ThemeColors, type ThemeName } from '../theme';
	import '../styles/tokens.css';

	type Props = {
		/** The theme whose color ladder the sheet lists. */
		theme?: ThemeName;
	};

	let { theme = 'eldritch' }: Props = $props();
	const colors = $derived(THEMES[theme].colors);

	function luminance(hex: string): number {
		const [r, g, b] = (hex.slice(1).match(/.{2}/g) ?? []).map((part) => {
			const channel = Number.parseInt(part, 16) / 255;
			return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
	}

	function contrast(first: string, second: string): string {
		const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
		return ((light! + 0.05) / (dark! + 0.05)).toFixed(2);
	}

	const surfaces = ['canvas', 'surface', 'surfaceRaised', 'surfaceSelected'] as const;
	const ladder: { role: keyof ThemeColors; use: string }[] = [
		{ role: 'canvas', use: 'Window, transcript, fields' },
		{ role: 'surface', use: 'Bay and workspace columns' },
		{ role: 'surfaceRaised', use: 'Buttons, chips, notices' },
		{ role: 'surfaceSelected', use: 'Open session, current tab' },
		{ role: 'surfaceOverlay', use: 'Menus, popovers, tooltips' },
		{ role: 'border', use: 'Pane rules' },
		{ role: 'borderControl', use: 'Control borders, 3:1' },
		{ role: 'borderStrong', use: 'Control border on hover' },
		{ role: 'text', use: 'Primary text' },
		{ role: 'textMuted', use: 'Secondary text' },
		{ role: 'textDisabled', use: 'Disabled labels' },
		{ role: 'accent', use: 'Needs you, the one primary' },
		{ role: 'focus', use: 'Focus ring, caret, selection' },
		{ role: 'success', use: 'Passed, added lines' },
		{ role: 'warning', use: 'Not responding, stopping' },
		{ role: 'danger', use: 'Failed, removed, Stop' },
		{ role: 'info', use: 'Running, starting' }
	];
	const spaces = [1, 2, 3, 4, 5, 6, 7, 8, 9];
	const roles = [
		{ name: 'Title', className: 'pau-view-title', sample: 'Audit log shutdown drain' },
		{ name: 'Heading', className: 'tokens-demo__heading', sample: 'Allow write to sessions.rs?' },
		{ name: 'Body', className: 'tokens-demo__body', sample: 'The audit writer drops its channel at shutdown.' },
		{ name: 'Row', className: 'tokens-demo__row', sample: 'Open workspace' },
		{ name: 'State line', className: 'tokens-demo__state', sample: 'Not responding for 1m' },
		{ name: 'Meta', className: 'tokens-demo__meta', sample: 'Claude Code · 4m' },
		{ name: 'Label', className: 'pau-section-label', sample: 'Needs you' },
		{ name: 'Code', className: 'tokens-demo__code', sample: 'cargo test --filter audit' }
	];
</script>

<!--
	The color ladder of one theme with each role's contrast on the four
	surface steps, then the spacing steps, the radii and the type roles.
-->
<div class="tokens-demo">
	<table>
		<caption class="pau-section-label">{THEMES[theme].label} colors</caption>
		<thead>
			<tr>
				<th scope="col">Role</th>
				<th scope="col">Use</th>
				{#each surfaces as surface (surface)}<th scope="col" class="pau-mono">on {surface}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each ladder as { role, use } (role)}
				<tr>
					<th scope="row">
						<span class="tokens-demo__swatch" style:background={colors[role]}></span>
						<span>{role}</span>
						<span class="pau-mono tokens-demo__hex">{colors[role]}</span>
					</th>
					<td>{use}</td>
					{#each surfaces as surface (surface)}<td class="pau-mono">{contrast(colors[role], colors[surface])}</td
						>{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<section aria-label="Spacing steps">
		<h2 class="pau-section-label">Spacing</h2>
		{#each spaces as step (step)}
			<div class="tokens-demo__space">
				<span class="pau-mono">space/{step}</span>
				<span class="tokens-demo__bar" style:width={`var(--pau-space-${step})`}></span>
			</div>
		{/each}
	</section>

	<section aria-label="Radii">
		<h2 class="pau-section-label">Radii</h2>
		<div class="tokens-demo__radii">
			<span class="tokens-demo__radius" style:border-radius="var(--pau-radius-control)">control 3px</span>
			<span class="tokens-demo__radius" style:border-radius="var(--pau-radius-overlay)">overlay 5px</span>
		</div>
	</section>

	<section aria-label="Type roles">
		<h2 class="pau-section-label">Type roles</h2>
		{#each roles as role (role.name)}
			<div class="tokens-demo__role">
				<span class="pau-mono tokens-demo__hex">{role.name}</span>
				<span class={role.className}>{role.sample}</span>
			</div>
		{/each}
	</section>
</div>

<style>
	.tokens-demo {
		display: grid;
		gap: var(--pau-space-6);
		padding: var(--pau-space-5);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}

	table {
		border-collapse: collapse;
		font-size: var(--pau-type-sm);
	}

	caption {
		padding-bottom: var(--pau-space-2);
		text-align: start;
	}

	th,
	td {
		height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		text-align: start;
		border-bottom: 1px solid var(--pau-border);
	}

	th[scope='row'] {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		font-weight: var(--pau-weight-medium);
	}

	.tokens-demo__swatch {
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--pau-border-control);
		border-radius: var(--pau-radius-control);
	}

	.tokens-demo__hex {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	section {
		display: grid;
		gap: var(--pau-space-2);
	}

	h2 {
		margin: 0;
	}

	.tokens-demo__space,
	.tokens-demo__role {
		display: grid;
		grid-template-columns: 6rem 1fr;
		align-items: center;
		gap: var(--pau-space-3);
	}

	.tokens-demo__bar {
		height: var(--pau-space-2);
		background: var(--pau-text-muted);
	}

	.tokens-demo__radii {
		display: flex;
		gap: var(--pau-space-3);
	}

	.tokens-demo__radius {
		padding: var(--pau-space-3) var(--pau-space-4);
		background: var(--pau-surface-raised);
		border: 1px solid var(--pau-border-control);
	}

	.tokens-demo__heading {
		font-size: var(--pau-type-lg);
		font-weight: var(--pau-weight-semibold);
		line-height: var(--pau-leading-prose);
	}

	.tokens-demo__body {
		line-height: var(--pau-leading-prose);
	}

	.tokens-demo__row {
		line-height: var(--pau-leading-row);
	}

	.tokens-demo__state {
		font-size: var(--pau-type-sm);
		line-height: var(--pau-leading-prose);
	}

	.tokens-demo__meta {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-tight);
	}

	.tokens-demo__code {
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-row);
	}
</style>
