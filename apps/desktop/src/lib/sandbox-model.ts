import type { EffectiveSandbox, SandboxSelection } from '@stormlightlabs/pau-protocol';
import type { EffectiveSandboxView, SandboxSelectionModel } from '@stormlightlabs/pau-ui';

/** Maps a stored selection to the settings view model. */
export function selectionView(selection: SandboxSelection): SandboxSelectionModel {
	if (selection.mode === 'unsandboxed') return { mode: 'unsandboxed' };
	const { settings } = selection;
	return {
		mode: 'sandboxed',
		settings: {
			profile: settings.profile,
			grants: {
				domains: settings.grants.domains,
				writableRoots: settings.grants.writable_roots,
				unixSockets: settings.grants.unix_sockets
			},
			homeReadDeny: settings.home_read_deny,
			shareClaudeTemp: settings.share_claude_temp,
			unsandboxedTools: settings.unsandboxed_tools
		}
	};
}

/** Maps the settings view model back to the wire selection. */
export function selectionWire(selection: SandboxSelectionModel): SandboxSelection {
	if (selection.mode === 'unsandboxed') return { mode: 'unsandboxed' };
	const { settings } = selection;
	return {
		mode: 'sandboxed',
		settings: {
			profile: settings.profile,
			grants: {
				domains: settings.grants.domains,
				writable_roots: settings.grants.writableRoots,
				unix_sockets: settings.grants.unixSockets
			},
			home_read_deny: settings.homeReadDeny,
			share_claude_temp: settings.shareClaudeTemp,
			unsandboxed_tools: settings.unsandboxedTools
		}
	};
}

/** Maps an effective profile to the settings view model. */
export function effectiveView(effective: EffectiveSandbox): EffectiveSandboxView {
	return {
		adapter: effective.adapter,
		platform: effective.platform,
		mechanism: effective.mechanism,
		verified: effective.verified,
		executables: effective.executables.map((executable) => ({
			name: executable.name,
			path: executable.path,
			version: executable.version ?? undefined
		})),
		profile: effective.profile,
		readable: {
			homeDenied: effective.readable.home_denied,
			allowed: effective.readable.allowed,
			denied: effective.readable.denied
		},
		writable: effective.writable,
		protected: effective.protected,
		network: {
			domains: effective.network.domains,
			localAddresses: effective.network.local_addresses,
			unixSockets: effective.network.unix_sockets
		},
		credentials: effective.credentials,
		environment: effective.environment,
		limits: effective.limits,
		sandboxedTools: effective.sandboxed_tools,
		unsandboxedTools: effective.unsandboxed_tools,
		disabledTools: effective.disabled_tools,
		placeholders: effective.placeholders,
		knownGaps: effective.known_gaps
	};
}
