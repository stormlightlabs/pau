export const prerender = true;

export const GET = () =>
	new Response('User-agent: *\nAllow: /\nSitemap: https://pau.stormlightlabs.org/sitemap.xml\n', {
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
