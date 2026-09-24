<script module lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import type { IconKind } from '../icons';

	/** Props for the shared Iconify-backed icon primitive. */
	export type IconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
		color?: string;
		label?: string;
		name: IconKind;
		size?: number | string;
	};
</script>

<script lang="ts">
	import { ICONS } from '../icons';
	import '../styles/icons.css';

	let { class: className = '', color, label, name, size = '1em', ...rest }: IconProps = $props();
	let resolvedSize = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<span
	{...rest}
	aria-hidden={label ? undefined : 'true'}
	aria-label={label}
	class={['pau-icon', ICONS[name], className]}
	role={label ? 'img' : undefined}
	style:--pau-icon-size={resolvedSize}
	style:color></span>

<style>
	.pau-icon {
		width: var(--pau-icon-size);
		height: var(--pau-icon-size);
	}
</style>
