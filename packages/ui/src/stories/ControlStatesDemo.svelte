<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import '../styles/tokens.css';

	const id = $props.id();
</script>

<!--
	One of each shared control class, enabled and disabled where the class has a
	disabled state, on the surface it sits on in the product. Each control
	carries `data-control` so the state test and the story read the same sheet.
-->
<div class="control-states">
	<section aria-labelledby="control-states-buttons">
		<h2 id="control-states-buttons" class="pau-section-label">Buttons</h2>
		<div class="control-states__row">
			<button type="button" class="pau-button pau-button--primary" data-control="primary">Send prompt</button>
			<button type="button" class="pau-button pau-button--primary" data-control="primary" disabled>Send prompt</button>
		</div>
		<div class="control-states__row">
			<button type="button" class="pau-button pau-button--secondary" data-control="secondary">Open workspace</button>
			<button type="button" class="pau-button pau-button--secondary" data-control="secondary" disabled>
				Open workspace
			</button>
		</div>
		<div class="control-states__row">
			<button type="button" class="pau-button pau-button--quiet" data-control="quiet">Attach image</button>
			<button type="button" class="pau-button pau-button--quiet" data-control="quiet" disabled>Attach image</button>
		</div>
		<div class="control-states__row">
			<button type="button" class="pau-button pau-button--danger" data-control="danger">Stop session</button>
			<button type="button" class="pau-button pau-button--danger" data-control="danger" disabled>Stop session</button>
		</div>
		<div class="control-states__row">
			<button type="button" class="pau-button pau-button--secondary"
				><Icon name="chevronDown" size={14} /><span>Jump to latest</span></button>
			<button type="button" class="pau-button pau-button--secondary"><span>Interrupt</span><kbd>Ctrl+C</kbd></button>
		</div>
		<div class="control-states__row">
			<button
				type="button"
				class="control-states__icon pau-utility-button"
				data-control="utility"
				aria-label="New terminal">
				<Icon name="plus" size={16} />
			</button>
			<button
				type="button"
				class="control-states__icon pau-utility-button"
				data-control="utility"
				aria-label="New terminal"
				disabled>
				<Icon name="plus" size={16} />
			</button>
		</div>
	</section>

	<section aria-labelledby="control-states-rows">
		<h2 id="control-states-rows" class="pau-section-label">Rows and tabs</h2>
		<div class="control-states__rail">
			<button type="button" class="control-states__rail-row pau-row" aria-current="page">Current session</button>
			<button type="button" class="control-states__rail-row pau-row" data-control="row">Fix the build</button>
			<button type="button" class="control-states__rail-row pau-row" data-control="row" aria-disabled="true">
				Coming soon
			</button>
		</div>
		<div class="control-states__rail">
			<button type="button" class="pau-strip pau-strip--row" data-control="strip"
				><Icon name="diffModified" size={16} /><span class="pau-strip__name pau-mono">src/lib/Select.svelte</span><span
					class="pau-strip__meta pau-mono">+12</span
				></button>
			<button type="button" class="pau-strip pau-strip--row" data-control="strip" aria-disabled="true"
				><Icon name="diffRemoved" size={16} /><span class="pau-strip__name pau-mono">src/lib/legacy.ts</span><span
					class="pau-strip__meta pau-mono">−40</span
				></button>
		</div>
		<div class="control-states__tabs" role="tablist" aria-label="Terminals">
			<button type="button" role="tab" class="control-states__tab pau-row" aria-selected="true">zsh</button>
			<button type="button" role="tab" class="control-states__tab pau-row" aria-selected="false" data-control="tab">
				cargo test
			</button>
			<button
				type="button"
				role="tab"
				class="control-states__tab pau-row"
				aria-selected="false"
				data-control="tab"
				disabled>
				offline
			</button>
		</div>
	</section>

	<section aria-labelledby="control-states-fields">
		<h2 id="control-states-fields" class="pau-section-label">Dropdowns</h2>
		<div class="control-states__row">
			<button type="button" class="pau-field" data-control="field"
				><span>Info</span><Icon name="chevronDown" size={12} /></button>
			<button type="button" class="pau-field" data-control="field" disabled
				><span>Info</span><Icon name="chevronDown" size={12} /></button>
			<button type="button" class="pau-field pau-field--quiet" data-control="quiet-field"
				><span>High</span><Icon name="chevronDown" size={12} /></button>
			<button type="button" class="pau-field pau-field--quiet" data-control="quiet-field" disabled
				><span>High</span><Icon name="chevronDown" size={12} /></button>
		</div>
		<div class="control-states__row">
			<input class="pau-field" aria-label="Filter" placeholder="Filter" data-control="text-field" />
			<input class="pau-field" aria-label="Filter, disabled" placeholder="Filter" data-control="text-field" disabled />
		</div>
		<div class="control-states__menu pau-menu" role="menu" aria-label="File actions">
			<button type="button" role="menuitem" class="pau-menu__item pau-option" data-control="menu-item"
				><Icon name="copy" size={16} /><span>Copy path</span></button>
			<button
				type="button"
				role="menuitem"
				class="pau-menu__item pau-option"
				data-control="menu-item"
				aria-disabled="true"><Icon name="terminal" size={16} /><span>Open in editor</span></button>
		</div>
		<div class="control-states__list" role="listbox" aria-label="Log level">
			<div role="option" class="control-states__option pau-option" tabindex="-1" aria-selected="true">Debug</div>
			<div
				role="option"
				class="control-states__option pau-option"
				tabindex="-1"
				aria-selected="false"
				data-control="option">
				Warning
			</div>
			<div
				role="option"
				class="control-states__option pau-option"
				tabindex="-1"
				aria-selected="false"
				aria-disabled="true"
				data-control="option">
				Trace
			</div>
		</div>
	</section>

	<section aria-labelledby="control-states-content">
		<h2 id="control-states-content" class="pau-section-label">Choices, disclosures, and links</h2>
		<div class="control-states__row">
			<label class="control-states__choice pau-choice" data-control="choice">
				<input type="radio" name={`${id}-motion`} checked /><span>System</span>
			</label>
			<label class="control-states__choice pau-choice" data-control="choice">
				<input type="radio" name={`${id}-motion`} disabled /><span>Full</span>
			</label>
		</div>
		<details class="pau-disclosure">
			<summary class="control-states__summary" data-control="disclosure">
				<Icon name="chevronRight" class="pau-disclosure__chevron" size={14} />Thinking
			</summary>
			<p>The disclosure body.</p>
		</details>
		<p>
			Read the <a class="pau-link" href="#control-states-content" data-control="link">sandbox guide</a> before granting network
			access.
		</p>
	</section>
</div>

<style>
	.control-states {
		display: grid;
		gap: var(--pau-space-5);
		max-width: 40rem;
		padding: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}

	section {
		display: grid;
		gap: var(--pau-space-2);
	}

	h2,
	p {
		margin: 0;
	}

	.control-states__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2);
	}

	.control-states__icon {
		display: grid;
		place-items: center;
		width: var(--pau-size-row-md);
		height: var(--pau-size-row-md);
		padding: 0;
		border: 0;
		border-radius: var(--pau-radius-control);
	}

	.control-states__rail {
		display: grid;
		width: 15.5rem;
		background: var(--pau-surface);
	}

	.control-states__rail-row {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-4);
		font: inherit;
		text-align: start;
		border: 0;
	}

	.control-states__rail-row[aria-current='page'] {
		color: var(--pau-text);
		background-color: var(--pau-surface-selected);
		box-shadow: inset 0 0 0 1px var(--pau-border-control);
	}

	.control-states__tabs {
		display: flex;
		background: var(--pau-canvas);
		border-bottom: 1px solid var(--pau-border);
	}

	.control-states__tab {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
		border: 0;
		border-right: 1px solid var(--pau-border);
	}

	.control-states__tab[aria-selected='true'] {
		color: var(--pau-text);
		background-color: var(--pau-surface-selected);
		box-shadow: inset 0 0 0 1px var(--pau-border-control);
	}

	.control-states__list,
	.control-states__menu {
		display: grid;
		width: 15.5rem;
		padding: var(--pau-space-1);
		background: var(--pau-surface-overlay);
		border: 1px solid var(--pau-border-control);
		border-radius: var(--pau-radius-overlay);
	}

	.control-states__option {
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		border-radius: var(--pau-radius-control);
	}

	.control-states__choice {
		display: inline-flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
	}

	.control-states__summary {
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
	}
</style>
