import type { ExtensionDialog } from './types/session';

/**
 * A tool call that Pau's permission extension holds until the operator
 * decides. The extension sends it as a `select` dialog whose title is a JSON
 * envelope, `{"pau":"permission","version":1,…}`, and whose options are the
 * decisions `allow_once`, `allow_session` and `deny`.
 */
export type PermissionRequest = {
	/** The dialog that carries the request. The answer goes back under its ID. */
	id: string;
	tool: string;
	/** What the tool does to its target, such as `write` or `read`. */
	operation?: string;
	command?: string;
	paths: string[];
	destination?: string;
	/** Why the rules ask, such as the rule that matched. */
	reason?: string;
	cwd?: string;
	/** The dialog's options, in order. Each is sent back as written. */
	options: string[];
	timeoutMs?: number;
};

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Reads a permission request from an extension dialog. Any other dialog,
 * including a select whose title is not the envelope, returns `undefined`
 * and keeps its focused dialog.
 */
export function permissionRequest(dialog: ExtensionDialog | undefined): PermissionRequest | undefined {
	if (dialog?.kind !== 'select') return undefined;
	const title = dialog.title.trim();
	if (!title.startsWith('{')) return undefined;
	let fields: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(title);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
		fields = parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
	if (fields.pau !== 'permission') return undefined;
	const paths = Array.isArray(fields.paths)
		? fields.paths.filter((path): path is string => typeof path === 'string')
		: [];
	return {
		id: dialog.id,
		tool: text(fields.tool) ?? 'a tool',
		operation: text(fields.operation),
		command: text(fields.command),
		paths,
		destination: text(fields.destination),
		reason: text(fields.reason) ?? text(fields.matchedRule),
		cwd: text(fields.cwd),
		options: dialog.options,
		timeoutMs: dialog.timeoutMs
	};
}

/** The question the request card asks, with the target that goes in the code face. */
export function permissionQuestion(request: PermissionRequest): { before: string; target?: string; after: string } {
	if (request.command) return { before: 'Run ', target: request.command, after: '?' };
	if (request.destination) return { before: 'Allow network access to ', target: request.destination, after: '?' };
	const path = request.paths[0];
	if (path) {
		const more = request.paths.length > 1 ? ` and ${request.paths.length - 1} more` : '';
		return { before: `Allow ${request.operation ?? request.tool} to `, target: path, after: `${more}?` };
	}
	return { before: `Allow ${request.tool}?`, after: '' };
}

/** How each decision reads on its button, with the key that chooses it. */
const DECISIONS: Record<string, { label: string; key: string }> = {
	allow_once: { label: 'Allow once', key: 'y' },
	allow_session: { label: 'Allow for session', key: 'a' },
	deny: { label: 'Deny', key: 'n' }
};

/** The button for one option. An option Pau does not know shows as written, with no key. */
export function permissionDecision(option: string): { label: string; key?: string } {
	return DECISIONS[option] ?? { label: option };
}
