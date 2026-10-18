/** Page zoom levels, matching the steps browsers use. */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/**
 * Returns the next zoom level in a direction, staying at the smallest or
 * largest level. A current factor between levels moves to the nearest level
 * in that direction.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
	const next =
		direction === 1
			? ZOOM_LEVELS.find((level) => level > current + 0.001)
			: ZOOM_LEVELS.findLast((level) => level < current - 0.001);
	return next ?? current;
}
