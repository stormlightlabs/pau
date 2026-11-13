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

/**
 * Scrolls a transcript to its newest content. Smooth scrolling gives way to an
 * instant jump when motion is reduced.
 */
export function scrollToLatest(node: HTMLElement): void {
	node.scrollTo({ top: node.scrollHeight, behavior: isReducedMotion() ? 'instant' : 'smooth' });
}

/**
 * Moves to the previous or next user prompt and focuses it so screen readers
 * announce it. The reference point is the focused prompt, or the viewport top
 * when focus is elsewhere. Does nothing past the first or last prompt. Scrolling
 * away from the bottom stops following. Smooth scrolling gives way to an
 * instant jump when motion is reduced.
 */
export function scrollToPrompt(node: HTMLElement, direction: 1 | -1): void {
	const prompts = [...node.querySelectorAll<HTMLElement>('.session-message--user')];
	const focused = prompts.findIndex((prompt) => prompt.contains(document.activeElement));
	let target: HTMLElement | undefined;
	if (focused !== -1) {
		target = prompts[focused + direction];
	} else {
		const top = node.getBoundingClientRect().top;
		const offset = (prompt: HTMLElement) => prompt.getBoundingClientRect().top - top;
		target = direction === 1 ? prompts.find((p) => offset(p) > 1) : prompts.findLast((p) => offset(p) < -1);
	}
	if (!target) return;
	target.focus({ preventScroll: true });
	target.scrollIntoView({ block: 'start', behavior: isReducedMotion() ? 'instant' : 'smooth' });
}

/**
 * Keeps a scroll container at its newest content while the operator is at the
 * bottom. WebKit has no scroll anchoring before Safari 27, so the action pins
 * explicitly after every size change of the container or its content, which
 * runs before the browser paints. Scrolling away from the bottom stops
 * following, but the action's own pins never do, even when output grows
 * before the browser reports them. Returning to the bottom resumes it. A
 * change of `key` starts at the bottom. Returning to a key restores the follow
 * mode or reading anchor it had when it was last shown, held in memory only.
 *
 * While following is off, the first entry in view keeps its position when
 * content above it grows or shrinks, such as a tool block that finishes or
 * collapses. The action turns off native scroll anchoring and restores that
 * entry itself, so every engine behaves the same.
 *
 * The first child of the node must wrap the content, so growth is observable.
 */
export function followTranscript(node: HTMLElement, options: TranscriptFollowOptions) {
	let { key, onChange } = options;
	let following = true;
	/** Per key: the reading anchor, or undefined while following the newest content. */
	const positions = new Map<string | undefined, ReadingAnchor | undefined>();
	/**
	 * The scroll position when the current anchor was read. A different
	 * position means the operator scrolled and the scroll event has not run
	 * yet, so the anchor is stale.
	 */
	let anchoredAt = node.scrollTop;
	/**
	 * The scroll position the last pin produced. The browser reports that
	 * scroll on a later frame, after new output may have grown the content,
	 * so the position no longer reads as the bottom. A scroll event at this
	 * position is the pin's own and must not stop following. The next scroll
	 * event clears it, so a later scroll by the operator to the same position
	 * still counts.
	 */
	let pinnedAt: number | undefined;
	node.style.overflowAnchor = 'none';

	function pin() {
		node.scrollTop = node.scrollHeight;
		pinnedAt = node.scrollTop;
	}

	function captureAnchor() {
		positions.set(key, following ? undefined : readAnchor(node));
		anchoredAt = node.scrollTop;
	}

	function setFollowing(next: boolean) {
		if (next === following) return;
		following = next;
		onChange(next);
	}

	function onScroll() {
		const ownPin = following && node.scrollTop === pinnedAt;
		pinnedAt = undefined;
		if (ownPin) return;
		setFollowing(atBottom(node));
		captureAnchor();
	}

	const resize = new ResizeObserver(() => {
		if (following) {
			pin();
			return;
		}
		const anchor = positions.get(key);
		if (anchor && node.scrollTop === anchoredAt) restoreAnchor(node, anchor);
		setFollowing(atBottom(node));
		captureAnchor();
	});
	if (node.firstElementChild) resize.observe(node.firstElementChild);
	resize.observe(node);
	node.addEventListener('scroll', onScroll, { passive: true });
	pin();

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
			pin();
		},
		destroy() {
			resize.disconnect();
			node.removeEventListener('scroll', onScroll);
		}
	};
}
