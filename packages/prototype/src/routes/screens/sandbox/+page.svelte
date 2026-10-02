<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	let sandboxed = $state(true);
	let homeReadDeny = $state(false);
	let domains = $state('registry.npmjs.org');
	let credentials = $state([{ source: 'PACKAGE_TOKEN', destinations: 'registry.npmjs.org' }]);

	const access = [
		['Writable', '~/work/pau · session temporary directory'],
		['Denied reads', '~/.ssh · ~/.aws · ~/.pi/agent/auth.json · .env'],
		['Protected', '.git/hooks · .git/config · .pi · .claude · .mcp.json · .zed'],
		['Environment', 'HOME, LANG, PATH, PAU_SANDBOX, TERM, TMPDIR'],
		['Inside the sandbox', 'read, bash, edit, write, grep, find, ls · MCP server docs'],
		['Disabled', 'Tools from other Pi extensions · MCP server linear']
	];
</script>

<PrototypePage
	section="V1 screen · 10"
	title="Agent sandbox"
	note="The sandbox starts off. Choosing it shows the access a launch will enforce before any agent tool runs.">
	<MockApp context="workspace / agent sandbox">
		<div class="mock-layout grid-cols-[3.5rem_minmax(0,1fr)]!">
			<ProductRail active="settings" />
			<section class="mock-main overflow-auto p-6" aria-label="Agent sandbox">
				<div class="mx-auto max-w-4xl">
					<header class="mb-5 flex items-end justify-between gap-4">
						<div>
							<p class="m-0 text-xs text-muted">Default for new agent sessions in this workspace</p>
							<h2 class="m-0 text-lg">Agent sandbox</h2>
						</div>
						<span class="border px-2 py-1 text-xs {sandboxed ? 'border-accent text-accent' : 'border-line text-muted'}"
							>Sandbox {sandboxed ? 'on' : 'off'}</span>
					</header>

					<fieldset class="m-0 grid gap-3 border-0 border-y border-line p-4">
						<legend class="text-xs font-semibold">Mode</legend>
						<label class="flex gap-2 text-sm"
							><input type="radio" name="mode" checked={!sandboxed} onchange={() => (sandboxed = false)} />
							<span
								>Unsandboxed <small class="block text-xs text-muted"
									>Normal access to files, network, and credentials.</small
								></span
							></label>
						<label class="flex gap-2 text-sm"
							><input type="radio" name="mode" checked={sandboxed} onchange={() => (sandboxed = true)} />
							<span
								>Sandboxed <small class="block text-xs text-muted">Nothing falls back to running outside it.</small
								></span
							></label>
						<p class="m-0 text-xs text-muted">
							Terminals and editors stay unsandboxed. Permission prompts never widen what the sandbox allows.
						</p>
					</fieldset>

					{#if sandboxed}
						<section class="grid grid-cols-2 gap-5 border-b border-line py-5">
							<label class="grid gap-1 text-xs"
								>Network destinations<textarea
									class="border border-line bg-canvas p-2 mock-code"
									rows="3"
									bind:value={domains}></textarea
								></label>
							<label class="flex items-start gap-2 text-xs"
								><input type="checkbox" bind:checked={homeReadDeny} />
								<span
									>Block reads from the home directory<small class="block text-muted"
										>Recommended while a network destination is granted.</small
									></span
								></label>
						</section>

						<section class="border-b border-line py-5" aria-labelledby="credential-title">
							<div class="flex items-center justify-between gap-3">
								<div>
									<h3 id="credential-title" class="m-0 text-sm">Credential references</h3>
									<p class="m-0 mt-1 text-xs text-muted">
										Pau saves variable names and TLS destinations, never values.
									</p>
								</div>
								<button
									class="app-button"
									type="button"
									onclick={() => (credentials = [...credentials, { source: '', destinations: '' }])}
									>Add credential reference</button>
							</div>
							{#if credentials.length === 0}
								<p class="m-0 mt-3 text-xs text-muted">No credential references.</p>
							{:else}
								<div class="mt-3 grid gap-3">
									{#each credentials as credential, index (credential)}
										<fieldset class="m-0 grid grid-cols-2 gap-3 border border-line p-3">
											<legend class="px-1 text-xs font-semibold">Credential {index + 1}</legend>
											<label class="grid gap-1 text-xs"
												>Source environment variable<input
													class="border border-line bg-canvas p-2 mock-code"
													type="text"
													bind:value={credential.source} /></label>
											<label class="grid gap-1 text-xs"
												>TLS destinations<textarea
													class="border border-line bg-canvas p-2 mock-code"
													rows="2"
													bind:value={credential.destinations}></textarea
												></label>
											<button
												class="app-button justify-self-start"
												type="button"
												onclick={() => (credentials = credentials.filter((_, itemIndex) => itemIndex !== index))}
												>Remove credential</button>
										</fieldset>
									{/each}
								</div>
							{/if}
						</section>

						<section class="border-b border-line py-5" aria-labelledby="effective-title">
							<h3 id="effective-title" class="m-0 text-sm">Effective access for Pi</h3>
							<p class="m-0 mt-1 text-xs text-muted">
								Bubblewrap 0.12.0 with network and PID namespaces and a seccomp socket filter on linux.
							</p>
							<div class="mt-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
								{#each access as [label, value] (label)}
									<span class="text-muted">{label}</span><span class="mock-code">{value}</span>
								{/each}
								<span class="text-muted">Network</span><span class="mock-code">{domains.trim() || 'Off'}</span>
								<span class="text-muted">Readable</span><span
									>{homeReadDeny
										? 'Outside the home directory, plus the workspace'
										: 'Everything except the denied paths'}</span>
							</div>
						</section>

						<section class="py-5">
							<h3 class="m-0 text-sm">Known gaps</h3>
							<ul class="m-0 mt-2 pl-4 text-xs text-muted">
								<li>Unix sockets cannot be filtered by path, so the socket grant allows all of them.</li>
								<li>Pi's MCP client connects to remote servers from the Pi process, not through the sandbox proxy.</li>
							</ul>
						</section>
					{/if}

					<div class="flex justify-end border-t border-line pt-4">
						<button class="app-button" type="button">Save workspace default</button>
					</div>
				</div>
			</section>
		</div>
	</MockApp>
</PrototypePage>
