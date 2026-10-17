import type { Reroute } from '@sveltejs/kit';

/**
 * The desktop shell opens the bundled `index.html` with the API port and launch
 * token in its query. That file is the app's root route, so route it there
 * instead of treating `/index.html` as an unknown page.
 */
export const reroute: Reroute = ({ url }) => (url.pathname === '/index.html' ? '/' : undefined);
