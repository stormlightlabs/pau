/**
 * TypeScript mirror of the motion tokens in `styles/tokens.css`, for Svelte
 * transitions that need numbers. A contract test keeps both in sync.
 */
export const motion = {
	duration: { instant: 0, feedback: 100, small: 150, medium: 200, large: 250 },
	ease: {
		standard: 'cubic-bezier(0.2, 0, 0, 1)',
		enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
		exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
		linear: 'linear'
	},
	/** Distances in rem. */
	offset: { sm: 0.25, md: 0.5 },
	scaleEnter: 0.98
} as const;

type MotionRoot = { dataset: DOMStringMap };
type MotionQuery = (query: string) => { matches: boolean };

/**
 * Reports whether movement should become a fade. The root `data-motion`
 * attribute wins when it is `reduce` or `full`. Otherwise the OS
 * `prefers-reduced-motion` query decides, matching `tokens.css`.
 */
export function isReducedMotion(
	root: MotionRoot = document.documentElement,
	matchMedia: MotionQuery = globalThis.matchMedia.bind(globalThis)
): boolean {
	const setting = root.dataset.motion;
	if (setting === 'reduce') return true;
	if (setting === 'full') return false;
	return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Distance in rem for a Svelte transition, or 0 when motion is reduced. */
export function motionOffset(size: keyof typeof motion.offset, reduced = isReducedMotion()): number {
	return reduced ? 0 : motion.offset[size];
}
