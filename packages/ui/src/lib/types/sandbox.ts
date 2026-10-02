/** Base sandbox profile. */
export type SandboxProfile = 'workspace-write' | 'read-only';

/** Explicit access added to a profile. */
export type SandboxGrantsModel = { domains: string[]; writableRoots: string[]; unixSockets: boolean };

/** A host credential reference and its configured TLS destinations. */
export type SandboxCredentialReferenceModel = { source: string; destinations: string[] };

/** Profile, grants, and options for a sandboxed selection. */
export type SandboxSettingsModel = {
	profile: SandboxProfile;
	grants: SandboxGrantsModel;
	homeReadDeny: boolean;
	shareClaudeTemp: boolean;
	unsandboxedTools: string[];
	credentialReferences: SandboxCredentialReferenceModel[];
};

/** Sandbox selection for agent tools. */
export type SandboxSelectionModel = { mode: 'unsandboxed' } | { mode: 'sandboxed'; settings: SandboxSettingsModel };

/** Agent whose execution boundary receives the profile. */
export type SandboxAdapterName = 'pi' | 'claude';

/** Profile enforced by a launch, described before any sandboxed work starts. */
export type EffectiveSandboxView = {
	adapter: SandboxAdapterName;
	platform: string;
	mechanism: string;
	verified: boolean;
	executables: { name: string; path: string; version?: string }[];
	profile: SandboxProfile;
	readable: { homeDenied: boolean; allowed: string[]; denied: string[] };
	writable: string[];
	protected: string[];
	network: { domains: string[]; localAddresses: string[]; unixSockets: boolean };
	credentials: { denied: string[]; references: SandboxCredentialReferenceModel[]; brokered: string[] };
	environment: string[];
	limits: string[];
	sandboxedTools: string[];
	unsandboxedTools: string[];
	disabledTools: string[];
	placeholders: string[];
	knownGaps: string[];
};
