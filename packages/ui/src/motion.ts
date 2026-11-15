/**
 * TypeScript mirror of the motion tokens in `styles/tokens.css`, for Svelte
 * transitions that need numbers. A contract test keeps both in sync.
 *
 * `quick` is for hover, press, selection and state color, `move` for
 * overlays, menus, dialogs and disclosures. The arrival, the system's one
 * authored motion, has its own travel, displacement and delay. Every
 * transition eases out; the arrival lifts and settles on `settle`.
 */
export const motion = {
	duration: { quick: 120, move: 240 },
	arrival: { travel: 640, displace: 480, delay: 90 },
	markSpin: 900,
	ease: { out: 'cubic-bezier(0.16, 1, 0.3, 1)', settle: 'cubic-bezier(0.2, 0, 0, 1)' },
	/** Distances in rem. */
	offset: { sm: 0.25, md: 0.5 },
	scaleEnter: 0.98
} as const;

/**
 * Timing for loading and busy indicators, in milliseconds. Waits shorter than
 * `delay` show no indicator, and a shown indicator stays for `minimumVisible`
 * so it never flickers.
 */
export const busyIndicatorTiming = { delay: 400, minimumVisible: 500 } as const;

/** How the interface moves: follow the OS, always reduce, or always animate. */
export type MotionSetting = 'system' | 'reduce' | 'full';

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
