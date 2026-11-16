import { isReducedMotion, motion } from '../motion';

/**
 * The arrival: the system's one authored motion. When a session starts
 * needing the operator, its strip lifts out of its rack, travels to the top
 * of Needs you and settles into the raised band, while the strips and
 * headings it passes slide aside. The strip's mark, state line and counts
 * have already changed when the travel starts, so the new state reads first.
 *
 * Elements that take part carry `data-bay-key`: a session ID on strips and a
 * section name on headings. The bay renders a moved strip as a new element in
 * its new rack, so positions are matched by key, not by element.
 */

/** Where each keyed strip and heading sat before an update, by key. */
export type BayPositions = Map<string, number>;

const LIFT = '0 12px 24px -8px rgb(4 6 12 / 72%), 0 2px 6px rgb(4 6 12 / 40%)';
const REST = '0 0 0 0 rgb(4 6 12 / 0%), 0 0 0 0 rgb(4 6 12 / 0%)';

function keyed(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[data-bay-key]')];
}

/** Records the top edge of every keyed element in the bay. Call it before the update renders. */
export function captureBay(root: HTMLElement): BayPositions {
	return new Map(keyed(root).map((element) => [element.dataset.bayKey ?? '', element.getBoundingClientRect().top]));
}

/**
 * Plays the arrival for the strips keyed in `arrived`, from the positions
 * captured before the update. A strip that was out of view, or new to the
 * bay, has no visible place to travel from and settles without moving.
 *
 * Under reduced motion every strip changes place at once and only its band
 * fades from the bay surface to the raised surface over 100ms.
 */
export function playArrival(
	root: HTMLElement,
	before: BayPositions,
	arrived: ReadonlySet<string>,
	reduced = isReducedMotion()
): void {
	const styles = getComputedStyle(root);
	const bay = styles.getPropertyValue('--pau-surface').trim() || 'transparent';
	const raised = styles.getPropertyValue('--pau-surface-raised').trim() || 'transparent';
	for (const element of keyed(root)) {
		const key = element.dataset.bayKey ?? '';
		const strip = arrived.has(key);
		if (reduced) {
			if (strip) element.animate([{ backgroundColor: bay }, { backgroundColor: raised }], { duration: 100 });
			continue;
		}
		const from = before.get(key);
		if (from === undefined) continue;
		const dy = from - element.getBoundingClientRect().top;
		if (!strip) {
			if (dy === 0) continue;
			element.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
				duration: motion.arrival.displace,
				delay: motion.arrival.delay,
				easing: motion.ease.out,
				fill: 'backwards'
			});
			continue;
		}
		element.style.zIndex = '1';
		const travel = element.animate(
			[
				{ transform: `translateY(${dy}px)`, boxShadow: REST, backgroundColor: bay, easing: motion.ease.settle },
				{
					transform: `translateY(${dy - 4}px)`,
					boxShadow: LIFT,
					backgroundColor: raised,
					offset: 0.15,
					easing: motion.ease.out
				},
				{
					transform: 'translateY(-4px)',
					boxShadow: LIFT,
					backgroundColor: raised,
					offset: 0.8,
					easing: motion.ease.settle
				},
				{ transform: 'none', boxShadow: REST, backgroundColor: raised }
			],
			{ duration: motion.arrival.travel }
		);
		void travel.finished.finally(() => element.style.removeProperty('z-index')).catch(() => {});
	}
}
