import type { Reroute } from '@sveltejs/kit';

/**
 * The bundled `index.html` is the app's root route. The desktop shell opens the
 * root directly, but a load of `/index.html` still shows the app instead of an
 * unknown page.
 */
export const reroute: Reroute = ({ url }) => (url.pathname === '/index.html' ? '/' : undefined);
