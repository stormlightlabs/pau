import { getContext } from 'svelte';

import { safeHref } from './markdown';

/** Hands an http, https, or mailto URL to the operating system's default handler. */
export type ExternalLinkOpener = (url: string) => Promise<void>;

/**
 * Context key under which the app owner provides its {@link ExternalLinkOpener}.
 *
 * The desktop app provides one because a click on a link would otherwise
 * navigate its only webview away from Pau. The development browser provides
 * none, so links keep the browser's own new-tab behavior.
 */
export const externalLinkContext = Symbol('pau.external-links');

/** Follows links the operator activates in a view. */
export type ExternalLinks = {
	/**
	 * Handles a click on an anchor that points at `url`. With an opener, it
	 * cancels the webview navigation and opens the link outside the app.
	 * Without one, it leaves the browser to follow the anchor.
	 */
	click(event: MouseEvent, url: string): void;
	/** Opens a link that has no anchor, such as a terminal hyperlink. */
	open(url: string): void;
};

/**
 * Returns the link handler for the calling component. Call it during component
 * initialization. Every path checks the URL with {@link safeHref}, so a
 * `javascript:`, `file:`, `data:`, relative, or custom-scheme link never
 * navigates.
 */
export function useExternalLinks(): ExternalLinks {
	const opener = getContext<ExternalLinkOpener | undefined>(externalLinkContext);
	const open = (url: string) => {
		const href = safeHref(url);
		if (!href) return;
		// A failed hand-off leaves the operator where they were; the link stays
		// visible and can be copied.
		if (opener) void opener(href).catch(() => {});
		else window.open(href, '_blank', 'noopener,noreferrer');
	};
	return {
		click(event, url) {
			if (!opener && safeHref(url)) return;
			event.preventDefault();
			if (opener) open(url);
		},
		open
	};
}
