<script lang="ts">
	type Props = {
		/** Accessible name, such as "Resize context rail". */
		label: string;
		/** Element ID of the pane this separator resizes. */
		controls: string;
		/** Current pane width in pixels. */
		value: number;
		min: number;
		/** Largest width that still leaves the main surface its minimum. */
		max: number;
		/** `1` when dragging right widens the pane, `-1` when dragging left does. */
		direction: 1 | -1;
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
		dragging = $bindable(false),
		onPreview,
		onCommit,
		onCancel
	}: Props = $props();

	const STEP = 16;
	const LARGE_STEP = 64;

	let startX = 0;
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
		startX = event.clientX;
		startWidth = value;
		pending = undefined;
		dragging = true;
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		pending = clamp(startWidth + (event.clientX - startX) * direction);
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
			case 'ArrowRight': {
				onCommit(clamp(value + step * direction));
				break;
			}
			case 'ArrowLeft': {
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
	role="separator"
	aria-orientation="vertical"
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

	.pane-resizer:hover::after,
	.pane-resizer.dragging::after {
		background: var(--pau-accent);
	}

	.pane-resizer:focus-visible {
		outline: none;
	}

	.pane-resizer:focus-visible::after {
		inset: 0 calc(50% - 2px);
		background: var(--pau-focus);
	}
</style>
