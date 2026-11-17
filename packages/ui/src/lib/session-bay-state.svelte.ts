import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

import type { SavedSession } from './types/session';

/** A workspace's saved sessions for the bay: loading, loaded, or failed. */
export type RecentSessions =
	{ status: 'loading' } | { status: 'ready'; sessions: SavedSession[] } | { status: 'failed' };

/**
 * What the bay remembers while the operator moves between views: the filter
 * text, each workspace's recent saved sessions, the order in which
 * sessions arrived in Needs you, and a strip waiting for focus. Every view mounts its own bay, so an app
 * that shows the bay in more than one view provides one instance with
 * {@link setSessionBayState}. Without one, each bay keeps its own.
 */
export class SessionBayState {
	#sequence = 0;
	/** Narrows the bay to strips whose name, agent or workspace match. */
	filter = $state('');
	/** Each workspace's saved sessions, by workspace ID. Absent until the first load starts. */
	recent = $state<Record<string, RecentSessions>>({});
	/**
	 * When each session in Needs you arrived there, as a rising sequence. The
	 * newest arrival leads the rack, so the session that just started waiting
	 * is the one the eye finds first.
	 */
	readonly needsSince = new SvelteMap<string, number>();
	/**
	 * The session whose strip takes focus once a bay shows it open. The
	 * attention jump sets it, since opening a session from another view
	 * mounts the session view's own bay.
	 */
	focusRequest = $state<string>();

	/** Records the sessions now in Needs you, keeping the arrival order of those already there. */
	trackNeeds(present: readonly string[]): void {
		for (const id of present) if (!this.needsSince.has(id)) this.needsSince.set(id, ++this.#sequence);
		for (const id of this.needsSince.keys()) if (!present.includes(id)) this.needsSince.delete(id);
	}
}

/** Context key of the shared bay state. Tests pass it to `render` in place of {@link setSessionBayState}. */
export const sessionBayStateContext = Symbol('pau.sessionBayState');

/** Shares one bay state with every bay mounted below the caller. Call it during component initialization. */
export function setSessionBayState(state: SessionBayState): SessionBayState {
	return setContext(sessionBayStateContext, state);
}

/** The bay state an ancestor shares, if any. */
export function getSessionBayState(): SessionBayState | undefined {
	return getContext<SessionBayState | undefined>(sessionBayStateContext);
}
