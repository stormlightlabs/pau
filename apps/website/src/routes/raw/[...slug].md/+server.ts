import { docs, getDoc } from '$lib/content';
import type { RequestHandler } from './$types';

export const prerender = true;

export function entries() {
	return docs.map(({ slug }) => ({ slug }));
}

export const GET: RequestHandler = ({ params }) => {
	const doc = getDoc(params.slug);
	return new Response(doc.raw, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
};
