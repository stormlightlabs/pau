<script lang="ts">
	type Props = {
		/** Accessible name, such as "Resize context rail". */
		label: string;
		/** Element ID of the pane this separator resizes. */
		controls: string;
		/** Current pane size in pixels: its width, or its height for a horizontal separator. */
		value: number;
		min: number;
		/** Largest width that still leaves the main surface its minimum. */
		max: number;
		/**
		 * `1` when dragging right, or down for a horizontal separator, grows the
		 * pane. `-1` when dragging left, or up, does.
		 */
		direction: 1 | -1;
		/**
		 * `vertical` for a separator between side-by-side panes, which resizes
		 * width. `horizontal` for one between stacked panes, which resizes height.
		 */
		orientation?: 'vertical' | 'horizontal';
		/** True while a pointer drag is in progress. */
		dragging?: boolean;
		/** Applies a width while dragging. Called at most once per frame. */
		onPreview: (width: number) => void;
		/** Keeps a width, or restores the default when `null`. */
		onCommit: (width: number | null) => void;
		/** Drops a drag that the browser cancelled. */
		onCancel: () => void;
	};

	let {
		label,
		controls,
		value,
		min,
		max,
		direction,
		orientation = 'vertical',
		dragging = $bindable(false),
		onPreview,
		onCommit,
		onCancel
	}: Props = $props();

	const STEP = 16;
	const LARGE_STEP = 64;

	let start = 0;
	const position = (event: PointerEvent) => (orientation === 'vertical' ? event.clientX : event.clientY);
	/** Keys that grow and shrink the pane along the separator's axis. */
	const growKey = $derived(orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown');
	const shrinkKey = $derived(orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp');
	let startWidth = 0;
	let pending: number | undefined;
	let frame: number | undefined;

	const clamp = (width: number) => Math.min(max, Math.max(min, Math.round(width)));

	function flush() {
		frame = undefined;
		if (pending !== undefined) onPreview(pending);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			// A synthetic pointer has nothing to capture. The drag still follows move events.
		}
		start = position(event);
		startWidth = value;
		pending = undefined;
		dragging = true;
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		pending = clamp(startWidth + (position(event) - start) * direction);
		frame ??= requestAnimationFrame(flush);
	}

	function finish(commit: boolean) {
		if (!dragging) return;
		dragging = false;
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		const width = pending;
		pending = undefined;
		if (commit && width !== undefined) onCommit(width);
		else onCancel();
	}

	function onKeyDown(event: KeyboardEvent) {
		const step = event.shiftKey ? LARGE_STEP : STEP;
		switch (event.key) {
			case growKey: {
				onCommit(clamp(value + step * direction));
				break;
			}
			case shrinkKey: {
				onCommit(clamp(value - step * direction));
				break;
			}
			case 'Home': {
				onCommit(min);
				break;
			}
			case 'End': {
				onCommit(max);
				break;
			}
			default: {
				return;
			}
		}
		event.preventDefault();
	}
</script>

<!-- A focusable separator is an interactive widget: the WAI-ARIA window splitter pattern. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="pane-resizer"
	class:dragging
	class:horizontal={orientation === 'horizontal'}
	role="separator"
	aria-orientation={orientation}
	aria-label={label}
	aria-controls={controls}
	aria-valuenow={value}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={() => finish(true)}
	onpointercancel={() => finish(false)}
	ondblclick={() => onCommit(null)}
	onkeydown={onKeyDown}>
</div>

<style>
	/* The element is a wider hit area than the visible line. */
	.pane-resizer {
		position: relative;
		z-index: 3;
		width: 0.5rem;
		cursor: col-resize;
		touch-action: none;
	}

	.pane-resizer::after {
		position: absolute;
		inset: 0 calc(50% - 1px);
		content: '';
	}

	.pane-resizer.horizontal {
		width: auto;
		height: 0.5rem;
		cursor: row-resize;
	}

	.pane-resizer.horizontal::after {
		inset: calc(50% - 1px) 0;
	}

	.pane-resizer.dragging::after {
		background: var(--pau-accent);
	}

	@media (hover: hover) {
		.pane-resizer:hover::after {
			background: var(--pau-accent);
		}
	}

	.pane-resizer:focus-visible {
		outline: none;
	}

	.pane-resizer:focus-visible::after {
		inset: 0 calc(50% - var(--pau-focus-width) / 2);
		background: var(--pau-focus);
	}

	.pane-resizer.horizontal:focus-visible::after {
		inset: calc(50% - var(--pau-focus-width) / 2) 0;
	}
</style>
