import { docs, getDoc } from '$lib/content';
import type { RequestHandler } from './$types';

export const prerender = true;

export function entries() {
	return docs.map(({ slug }) => ({ slug }));
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		const entities: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };
		return entities[character];
	});
}

export const GET: RequestHandler = ({ params }) => {
	const doc = getDoc(params.slug);
	const title = escapeXml(doc.title);
	const body = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#242933"/><text x="80" y="140" fill="#88c0d0" font-family="sans-serif" font-size="42">Pau documentation</text><text x="80" y="330" fill="#eceff4" font-family="sans-serif" font-size="72" font-weight="700">${title}</text></svg>`;
	return new Response(body, { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } });
};
