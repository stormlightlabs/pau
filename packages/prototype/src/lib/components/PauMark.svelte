<script lang="ts">
	import markUrl from '$lib/assets/pau-icon.png?url';

	let { label }: { label?: string } = $props();
</script>

<img class="pau-mark" src={markUrl} alt={label ?? ''} />

<style>
	.pau-mark {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
