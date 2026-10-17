import type { ExtensionDialog as WireDialog, SessionExtensionUi } from '@stormlightlabs/pau-protocol';
import type {
	ExtensionDialog,
	ExtensionNotification,
	ExtensionStatus,
	ExtensionUiState,
	ExtensionWidget
} from '@stormlightlabs/pau-ui';

/**
 * Extension UI for one live session. Unlike {@link ExtensionUiState}, it keeps
 * every unanswered dialog, oldest first, because Pi can wait on several and
 * the session view shows one at a time.
 */
export type LiveExtensionUi = {
	dialogs: ExtensionDialog[];
	notifications: ExtensionNotification[];
	statuses: ExtensionStatus[];
	widgets: ExtensionWidget[];
};

/** Why a dialog stopped waiting without an answer from this client. */
export type ExtensionResolution = 'timed_out' | 'interrupted' | 'exited' | 'stale';

export const emptyExtensionUi: LiveExtensionUi = { dialogs: [], notifications: [], statuses: [], widgets: [] };

const RESOLUTION_MESSAGES: Record<ExtensionResolution, string> = {
	timed_out: 'An extension request expired before it was answered.',
	interrupted: 'An extension request was cancelled when the run was interrupted.',
	exited: 'The session ended before the extension request was answered.',
	stale: 'That extension request was already answered, cancelled, or expired.'
};

type JsonObject = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function fromWireDialog(dialog: WireDialog): ExtensionDialog {
	if (dialog.kind === 'unsupported') return dialog;
	const { id, title } = dialog;
	if (dialog.kind === 'editor') return { id, kind: 'editor', title, prefill: dialog.prefill ?? undefined };
	const timeoutMs = dialog.timeout_ms ?? undefined;
	if (dialog.kind === 'select') return { id, kind: 'select', title, options: dialog.options, timeoutMs };
	if (dialog.kind === 'confirm') return { id, kind: 'confirm', title, message: dialog.message, timeoutMs };
	return { id, kind: 'input', title, placeholder: dialog.placeholder ?? undefined, timeoutMs };
}

/**
 * Replaces the persistent parts of a session's extension UI with the
 * backend's copy. Notifications are transient and stay as they are.
 */
export function withServerExtensionUi(state: LiveExtensionUi, server: SessionExtensionUi): LiveExtensionUi {
	return {
		dialogs: server.dialogs.map((dialog) => {
			const mapped = fromWireDialog(dialog);
			// The component times dialogs from when they render, so keep the
			// fields of a dialog that was already showing.
			return state.dialogs.find((existing) => existing.id === mapped.id) ?? mapped;
		}),
		notifications: state.notifications,
		statuses: server.statuses,
		widgets: server.widgets
	};
}

function upsertByKey<T extends { key: string }>(items: T[], key: string, next: T | undefined): T[] {
	const index = items.findIndex((item) => item.key === key);
	if (!next) return index === -1 ? items : items.filter((item) => item.key !== key);
	if (index === -1) return [...items, next];
	return items.map((item, position) => (position === index ? next : item));
}

/** Adds a notification that expires on the caller's timer. */
export function withNotification(state: LiveExtensionUi, notification: ExtensionNotification): LiveExtensionUi {
	if (state.notifications.some((existing) => existing.id === notification.id)) return state;
	return { ...state, notifications: [...state.notifications, notification] };
}

/** Removes one notification. */
export function withoutNotification(state: LiveExtensionUi, id: string): LiveExtensionUi {
	return { ...state, notifications: state.notifications.filter((notification) => notification.id !== id) };
}

/** Drops an answered dialog. */
export function withoutDialog(state: LiveExtensionUi, id: string): LiveExtensionUi {
	return { ...state, dialogs: state.dialogs.filter((dialog) => dialog.id !== id) };
}

/**
 * Drops a dialog that stopped waiting and, when it was still open, tells the
 * operator why it closed.
 */
export function resolveDialog(state: LiveExtensionUi, id: string, reason: ExtensionResolution): LiveExtensionUi {
	if (state.dialogs.every((dialog) => dialog.id !== id)) return state;
	return withNotification(withoutDialog(state, id), {
		id: `resolved:${id}`,
		level: 'warning',
		message: RESOLUTION_MESSAGES[reason]
	});
}

/** Closes every dialog of a session that exited. Statuses and widgets go with it. */
export function exitedExtensionUi(state: LiveExtensionUi): LiveExtensionUi {
	let closed = state;
	for (const dialog of state.dialogs) closed = resolveDialog(closed, dialog.id, 'exited');
	return { ...closed, statuses: [], widgets: [] };
}

function resolution(value: unknown): ExtensionResolution {
	const reasons: unknown[] = ['timed_out', 'interrupted', 'exited'];
	return reasons.includes(value) ? (value as ExtensionResolution) : 'stale';
}

/** Whether a `session_output` payload belongs to the extension UI rather than the transcript. */
export function isExtensionEvent(event: unknown): event is JsonObject {
	if (typeof event !== 'object' || event === null) return false;
	const type = (event as JsonObject).type;
	return type === 'extension_ui_request' || type === 'extension_ui_resolved';
}

/** Request methods that never wait for an answer. */
const DIRECT_METHODS = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']);

/**
 * Whether an extension event may add a dialog. The event stream replays old
 * requests after a reconnect, so dialogs come only from the backend's copy of
 * the extension UI, which knows which requests still wait.
 */
export function opensDialog(event: JsonObject): boolean {
	return event.type === 'extension_ui_request' && !DIRECT_METHODS.has(String(event.method));
}

/**
 * Applies one extension event from `session_output`: notifications, status
 * lines, widgets, and the backend's `extension_ui_resolved`. Dialog requests
 * and other payloads return the state unchanged; see {@link opensDialog}.
 */
export function reduceExtensionEvent(state: LiveExtensionUi, event: unknown): LiveExtensionUi {
	if (!isExtensionEvent(event)) return state;
	const id = optionalString(event.id);
	if (!id) return state;
	if (event.type === 'extension_ui_resolved') {
		// A dialog answered in another window needs no explanation here.
		if (event.reason === 'answered') return withoutDialog(state, id);
		return resolveDialog(state, id, resolution(event.reason));
	}

	switch (event.method) {
		case 'notify': {
			const message = optionalString(event.message);
			if (!message) return state;
			const level = event.notifyType === 'warning' || event.notifyType === 'error' ? event.notifyType : 'info';
			return withNotification(state, { id, message, level });
		}
		case 'setStatus': {
			const key = optionalString(event.statusKey);
			if (!key) return state;
			const text = optionalString(event.statusText);
			return { ...state, statuses: upsertByKey(state.statuses, key, text === undefined ? undefined : { key, text }) };
		}
		case 'setWidget': {
			const key = optionalString(event.widgetKey);
			if (!key) return state;
			const lines = strings(event.widgetLines);
			const placement = event.widgetPlacement === 'belowEditor' ? 'below-editor' : 'above-editor';
			return { ...state, widgets: upsertByKey(state.widgets, key, lines && { key, lines, placement }) };
		}
	}
	return state;
}

/** Projects the live state onto the component's one-dialog view. */
export function extensionUiView(state: LiveExtensionUi): ExtensionUiState {
	return {
		dialog: state.dialogs[0],
		notifications: state.notifications,
		statuses: state.statuses,
		widgets: state.widgets
	};
}
