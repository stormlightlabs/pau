/**
 * Approvals granted with `allow_session`. They live only in the Pi process and
 * are cleared when the session starts or shuts down, so no approval outlives
 * its session.
 */
import { wildcardMatch } from '#src/policy/wildcard-matcher';
import type { WildcardMatchOptions } from '#src/policy/wildcard-matcher';
import type { Surface } from './policy.ts';

/** One granted pattern on one surface, such as `touch *` on `bash`. */
export type Grant = { surface: Surface; pattern: string };

export class SessionApprovals {
	#grants: Grant[] = [];

	/** Record the grants an `allow_session` answer approved. */
	add(grants: readonly Grant[]): void {
		this.#grants.push(...grants);
	}

	/**
	 * The grant that covers any of `values` on `surface`, if one does. A grant
	 * only turns an ask into an allow; the gate never consults it for a deny.
	 */
	covering(surface: Surface, values: readonly string[], options?: WildcardMatchOptions): Grant | undefined {
		return this.#grants.find(
			(grant) => grant.surface === surface && values.some((value) => wildcardMatch(grant.pattern, value, options))
		);
	}

	clear(): void {
		this.#grants = [];
	}
}
