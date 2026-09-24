import { docs, getDoc } from '$lib/content';

export function entries() {
	return docs.map(({ slug }) => ({ slug }));
}

export function load({ params }) {
	const doc = getDoc(params.slug);
	return { description: doc.description, slug: doc.slug, title: doc.title };
}
