import { docs } from '$lib/content';

export const prerender = true;

export const GET = () => {
	const links = docs
		.map((doc) => `- [${doc.title}](https://pau.stormlightlabs.org/raw/${doc.slug}.md): ${doc.description}`)
		.join('\n');

	return new Response(`# Pau\n\nDocumentation for Pau.\n\n${links}\n`, {
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
};
