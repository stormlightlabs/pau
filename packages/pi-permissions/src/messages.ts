/**
 * The messages Pau and the extension exchange through Pi's RPC extension UI.
 *
 * Pi gives an extension no structured output of its own, so a request travels
 * as a `select` dialog whose title is a versioned JSON envelope, and each
 * outcome travels as a `setStatus` record under `pau.permission`. Pau parses
 * both only in sessions it launched with this extension.
 */
import * as v from 'valibot';
import type { Evaluation, ToolCall } from './gate.ts';

/** The `select` options of every request, in order. */
export const DECISIONS = ['allow_once', 'allow_session', 'deny'] as const;

/** An operator decision. */
export type Decision = (typeof DECISIONS)[number];

/** The status key of decision records. */
export const STATUS_KEY = 'pau.permission';

/** The request envelope carried in the dialog title. */
export type RequestEnvelope = {
	pau: 'permission';
	version: 1;
	requestId: string;
	toolCallId: string;
	/**
	 * The codemode call that started this one. Absent for direct calls and on
	 * Pi releases before 0.99, which do not report it.
	 */
	parentToolCallId?: string;
} & Pick<
	Evaluation,
	'tool' | 'operation' | 'command' | 'paths' | 'destination' | 'matchedRule' | 'reason' | 'sessionScope'
>;

/** Build the dialog title for a request. */
export function requestTitle(
	requestId: string,
	{ toolCallId, parentToolCallId }: Pick<ToolCall, 'toolCallId' | 'parentToolCallId'>,
	evaluation: Evaluation
): string {
	const { tool, operation, command, paths, destination, matchedRule, reason, sessionScope } = evaluation;
	const envelope: RequestEnvelope = {
		pau: 'permission',
		version: 1,
		requestId,
		toolCallId,
		...(parentToolCallId && { parentToolCallId }),
		tool,
		operation,
		...(command !== undefined && { command }),
		paths,
		...(destination && { destination }),
		matchedRule,
		...(reason && { reason }),
		sessionScope
	};
	return JSON.stringify(envelope);
}

const ReasonSchema = v.pipe(v.string(), v.maxLength(2000));
const AnswerSchema = v.strictObject({ decision: v.picklist(DECISIONS), reason: v.optional(ReasonSchema) });

/** A parsed answer. */
export type Answer = { decision: Decision; reason?: string };

/**
 * Parse a dialog value. Pau sends JSON `{decision, reason?}`; a bare option
 * string is also accepted. A missing, unknown, or invalid value is a denial,
 * so the caller never has to guess what an operator meant.
 */
export function parseAnswer(value: string | undefined): Answer {
	if (value === undefined) return { decision: 'deny' };
	if ((DECISIONS as readonly string[]).includes(value)) return { decision: value as Decision };
	try {
		const parsed = v.safeParse(AnswerSchema, JSON.parse(value));
		if (parsed.success) return parsed.output;
	} catch {
		// Not JSON. Fall through to the denial.
	}
	return { decision: 'deny' };
}

/** What produced an outcome. */
export type OutcomeSource = 'rule' | 'session' | 'operator' | 'abort' | 'timeout' | 'policy_error';

/** A decision record. It never carries the command or paths. */
export type DecisionRecord = {
	version: 1;
	requestId: string;
	toolCallId: string;
	outcome: 'allowed' | 'denied';
	source: OutcomeSource;
};

/** Serialize a decision record for `setStatus`. */
export function decisionRecord(
	requestId: string,
	toolCallId: string,
	outcome: DecisionRecord['outcome'],
	source: OutcomeSource
): string {
	const record: DecisionRecord = { version: 1, requestId, toolCallId, outcome, source };
	return JSON.stringify(record);
}
