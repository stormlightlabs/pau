import type { Component } from 'svelte';
import * as v from 'valibot';

const metadataSchema = v.strictObject({
	title: v.pipe(v.string(), v.minLength(1)),
	description: v.pipe(v.string(), v.minLength(1)),
	order: v.pipe(v.number(), v.integer(), v.minValue(0))
});

type Metadata = v.InferOutput<typeof metadataSchema>;
type ContentModule = { default: Component; metadata: unknown };

export type Doc = Metadata & { component: Component; raw: string; slug: string };

const contentModules = import.meta.glob<ContentModule>('../content/docs/*.svx', { eager: true });
const rawModules = import.meta.glob<string>('../content/docs/*.svx', { eager: true, import: 'default', query: '?raw' });

/** Validated documentation pages in navigation order. */
export const docs: Doc[] = Object.entries(contentModules)
	.map(([path, content]) => {
		const slug = path
			.split('/')
			.at(-1)
			?.replace(/\.svx$/, '');
		const raw = rawModules[path];
		if (!slug || raw === undefined) {
			throw new Error(`Could not load documentation source: ${path}`);
		}

		return { ...v.parse(metadataSchema, content.metadata), component: content.default, raw, slug };
	})
	.sort((left, right) => left.order - right.order);

/** Return one documentation page or fail the static build. */
export function getDoc(slug: string): Doc {
	const doc = docs.find((candidate) => candidate.slug === slug);
	if (!doc) {
		throw new Error(`Unknown documentation page: ${slug}`);
	}
	return doc;
}
