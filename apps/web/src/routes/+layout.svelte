<script lang="ts">
	let { children } = $props();
</script>

{@render children()}

<style>
	:global(html) {
		color-scheme: dark;
		background: #171827;
	}

	:global(body) {
		margin: 0;
	}
</style>
