<script lang="ts">
	import piLogo from '$lib/assets/pi-logo.svg';

	let { class: className = '' }: { class?: string } = $props();
</script>

<img class={className} src={piLogo} alt="" aria-hidden="true" />
