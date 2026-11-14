import type { ResourceEntry, ResourceKind, ResourceScope, ResourceTrust } from './types/resources';

/** Resource kinds in the order the browser lists its views. */
export const RESOURCE_KINDS = ['skill', 'prompt', 'extension', 'theme', 'package'] as const satisfies ResourceKind[];

/** Plural view names, which also serve as the browser's URL segments in lowercase. */
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
	skill: 'Skills',
	prompt: 'Prompts',
	extension: 'Extensions',
	theme: 'Themes',
	package: 'Packages'
};

/** What the operator narrowed the list to. `all` keeps every value. */
export type ResourceFilter = { query: string; scope: ResourceScope | 'all'; trust: ResourceTrust | 'all' };

export const NO_RESOURCE_FILTER: ResourceFilter = { query: '', scope: 'all', trust: 'all' };

/**
 * Resources of one kind that pass the filter, in the index's order. The query
 * matches the name case-insensitively, ignoring surrounding space.
 */
export function filterResources(
	resources: ResourceEntry[],
	kind: ResourceKind,
	filter: ResourceFilter
): ResourceEntry[] {
	const query = filter.query.trim().toLowerCase();
	return resources.filter(
		(resource) =>
			resource.kind === kind &&
			(filter.scope === 'all' || resource.scope === filter.scope) &&
			(filter.trust === 'all' || resource.trust === filter.trust) &&
			resource.name.toLowerCase().includes(query)
	);
}

/** Counts resources of each kind, for the view rail. */
export function countByKind(resources: ResourceEntry[]): Record<ResourceKind, number> {
	const counts = Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind, 0])) as Record<ResourceKind, number>;
	for (const resource of resources) counts[resource.kind] += 1;
	return counts;
}

/** Reads a browser URL segment such as `prompts`, falling back to skills. */
export function resourceKindFromSegment(segment: string | undefined): ResourceKind {
	return RESOURCE_KINDS.find((kind) => `${kind}s` === segment) ?? 'skill';
}

/**
 * The one state a row shows beside its scope, most severe first: a status
 * that keeps the resource from loading, then missing trust, then warnings.
 * `undefined` means it loads cleanly.
 */
export function resourceAttention(resource: ResourceEntry): { label: string; tone: 'danger' | 'warning' } | undefined {
	if (resource.status === 'invalid') return { label: 'Invalid', tone: 'danger' };
	if (resource.status === 'missing') return { label: 'Not installed', tone: 'danger' };
	if (resource.status === 'duplicate') return { label: 'Duplicate', tone: 'warning' };
	if (resource.trust !== 'trusted') return { label: TRUST_LABELS[resource.trust], tone: 'warning' };
	if (resource.warnings.length > 0)
		return {
			label: resource.warnings.length === 1 ? '1 warning' : `${resource.warnings.length} warnings`,
			tone: 'warning'
		};
	return undefined;
}

export const TRUST_LABELS: Record<ResourceTrust, string> = {
	trusted: 'Trusted',
	untrusted: 'Not trusted',
	undecided: 'Trust not decided'
};
