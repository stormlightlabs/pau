/** Space kept between a floating surface and the window edge, in pixels. */
const edge = 8;
/** Space between a floating surface and its trigger, in pixels. */
const gap = 4;

/** Where a floating surface sits against its trigger, in viewport pixels. */
export type AnchoredPlacement = {
	left: number;
	top: number;
	/** Whether the surface opens above the trigger. */
	above: boolean;
	/** Height left on the chosen side before the window edge. Callers cap the surface at it. */
	room: number;
};

/** Side of the trigger a surface opens on when it fits there. */
export type AnchoredSide = 'below' | 'above';

/**
 * Places a top-layer surface, such as a dropdown list or its error, against
 * the trigger that owns it. The surface opens on the preferred side when it
 * fits there, and otherwise on the side with more room. Controls in the
 * composer footer prefer `above`, so their surfaces never cover the actions
 * under them. The surface starts at the trigger's leading edge and moves left
 * only as far as it must to stay inside the window, so a trigger near either
 * edge keeps its surface on screen.
 *
 * @param anchor The trigger's viewport box.
 * @param width The surface's rendered width.
 * @param height The surface's natural height, before any cap.
 * @param prefer The side to open on when the surface fits there.
 */
export function placeAgainst(
	anchor: DOMRect,
	width: number,
	height: number,
	prefer: AnchoredSide = 'below'
): AnchoredPlacement {
	const below = innerHeight - anchor.bottom - gap - edge;
	const over = anchor.top - gap - edge;
	const fits = height <= (prefer === 'above' ? over : below);
	const above = fits ? prefer === 'above' : over > below;
	const room = Math.max(0, above ? over : below);
	return {
		left: Math.max(edge, Math.min(anchor.left, innerWidth - width - edge)),
		top: above ? anchor.top - gap - Math.min(height, room) : anchor.bottom + gap,
		above,
		room
	};
}
