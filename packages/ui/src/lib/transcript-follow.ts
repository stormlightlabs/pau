import { isReducedMotion } from '../motion';

/** Distance in pixels from the bottom that still counts as being at the bottom. */
export const followThreshold = 8;

/** Parameters for {@link followTranscript}. */
export type TranscriptFollowOptions = {
	/** Changes when the transcript shows different content, such as another session. */
	key: string | undefined;
	/** Called when following starts or stops. */
	onChange: (following: boolean) => void;
};

function atBottom(node: HTMLElement): boolean {
	return node.scrollHeight - node.clientHeight - node.scrollTop <= followThreshold;
}

/** Where the operator was reading: an entry and how far its top sits below the viewport top. */
type ReadingAnchor = { entryId: string; offset: number };

/** The first entry that reaches into the viewport, or undefined when none does. */
function readAnchor(node: HTMLElement): ReadingAnchor | undefined {
	const top = node.getBoundingClientRect().top;
	for (const entry of node.querySelectorAll<HTMLElement>('[data-entry-id]')) {
		const rect = entry.getBoundingClientRect();
		if (rect.bottom > top) return { entryId: entry.dataset.entryId!, offset: rect.top - top };
	}
	return undefined;
}

/** Scrolls so the anchor entry sits at its recorded offset. Returns false when it is gone. */
function restoreAnchor(node: HTMLElement, anchor: ReadingAnchor): boolean {
	const entry = [...node.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
		(candidate) => candidate.dataset.entryId === anchor.entryId
	);
	if (!entry) return false;
	node.scrollTop += entry.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset;
	return true;
}

function pin(node: HTMLElement): void {
	node.scrollTop = node.scrollHeight;
}

/**
 * Scrolls a transcript to its newest content. Smooth scrolling gives way to an
 * instant jump when motion is reduced.
 */
export function scrollToLatest(node: HTMLElement): void {
	node.scrollTo({ top: node.scrollHeight, behavior: isReducedMotion() ? 'instant' : 'smooth' });
}

/**
 * Keeps a scroll container at its newest content while the operator is at the
 * bottom. WebKit has no scroll anchoring before Safari 27, so the action pins
 * explicitly after every size change of the container or its content, which
 * runs before the browser paints. Scrolling away from the bottom stops
 * following. Returning to the bottom resumes it. A change of `key` starts at
 * the bottom. Content above the reading position is never moved while
 * following is off. Returning to a key restores the follow mode or reading
 * anchor it had when it was last shown, held in memory only.
 *
 * The first child of the node must wrap the content, so growth is observable.
 */
export function followTranscript(node: HTMLElement, options: TranscriptFollowOptions) {
	let { key, onChange } = options;
	let following = true;
	/** Per key: the reading anchor, or undefined while following the newest content. */
	const positions = new Map<string | undefined, ReadingAnchor | undefined>();

	function setFollowing(next: boolean) {
		if (next === following) return;
		following = next;
		onChange(next);
	}

	function onScroll() {
		setFollowing(atBottom(node));
		positions.set(key, following ? undefined : readAnchor(node));
	}

	const resize = new ResizeObserver(() => {
		if (following) pin(node);
		else setFollowing(atBottom(node));
	});
	if (node.firstElementChild) resize.observe(node.firstElementChild);
	resize.observe(node);
	node.addEventListener('scroll', onScroll, { passive: true });
	pin(node);

	return {
		update(next: TranscriptFollowOptions) {
			onChange = next.onChange;
			if (next.key === key) return;
			key = next.key;
			const anchor = positions.get(key);
			if (anchor && restoreAnchor(node, anchor)) {
				setFollowing(false);
				return;
			}
			following = false;
			setFollowing(true);
			pin(node);
		},
		destroy() {
			resize.disconnect();
			node.removeEventListener('scroll', onScroll);
		}
	};
}
