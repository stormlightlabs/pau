/** Kind of agent resource, as the resource index API names it. */
export type ResourceKind = 'skill' | 'prompt' | 'extension' | 'theme' | 'package';

/** Whose configuration a resource belongs to. */
export type ResourceScope = 'user' | 'project';

/** Whether the agent loads the resource's scope. */
export type ResourceTrust = 'trusted' | 'untrusted' | 'undecided';

/** Whether the resource loads, apart from trust. */
export type ResourceStatus = 'ready' | 'duplicate' | 'invalid' | 'missing';

/** One resource from the resource index API. Field names match the wire. */
export type ResourceEntry = {
	id: string;
	kind: ResourceKind;
	name: string;
	description: string | null;
	/** Resource file, or an installed package's directory. */
	path: string | null;
	scope: ResourceScope;
	source_kind: 'directory' | 'setting' | 'package';
	/** The scanned directory, the settings file, or the package source. */
	source: string;
	trust: ResourceTrust;
	status: ResourceStatus;
	/** Path of the resource that loads instead of a duplicate. */
	winner: string | null;
	warnings: string[];
};

/** A discovery problem that belongs to no single resource. */
export type ResourceIndexWarning = { path: string; message: string };

/** Every resource the agent finds for a workspace. */
export type ResourceIndex = {
	resources: ResourceEntry[];
	warnings: ResourceIndexWarning[];
	project_trust: ResourceTrust;
};
