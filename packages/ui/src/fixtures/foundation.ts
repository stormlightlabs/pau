import type { IconKind } from '../icons';
import type { SessionStatus } from '../lib/types/session';

/** A state tone class from `styles/states.css`, or none for muted text. */
export type Tone = 'waiting' | 'danger' | 'warning' | 'info' | 'success' | undefined;

/** One session status with its label and the tone its state line takes. */
export type MarkState = { status: SessionStatus; label: string; tone: Tone };

/** One session strip in the bay: name, agent, workspace, state line and age. */
export type StripFixture = {
	id: string;
	status: SessionStatus;
	name: string;
	agent: string;
	workspace: string;
	state: string;
	age: string;
};

/** A bay section: its label, whether it needs the operator, and its strips. */
export type BaySection = { label: string; attention: boolean; settled: boolean; strips: StripFixture[] };

/** A one-line row strip, such as a changed file or a terminal. */
export type RowFixture = { id: string; icon: IconKind; name: string; meta: string; mono: boolean };

/** One menu row: label, optional icon, hint or key, and a disabled reason. */
export type MenuItemFixture = {
	label: string;
	icon?: IconKind;
	hint?: string;
	keys?: string;
	checked?: boolean;
	disabled?: boolean;
};

/** A notice in one tone, with its title, body and actions. */
export type NoticeFixture = {
	tone: 'info' | 'warning' | 'danger';
	icon: IconKind;
	title: string;
	body: string;
	actions: string[];
};

/** Every session status in bay order, with the label and tone the strip shows. */
export const markStates: MarkState[] = [
	{ status: 'waiting', label: 'Waiting for you', tone: 'waiting' },
	{ status: 'failed', label: 'Failed', tone: 'danger' },
	{ status: 'not_responding', label: 'Not responding', tone: 'warning' },
	{ status: 'running', label: 'Running', tone: 'info' },
	{ status: 'starting', label: 'Starting', tone: 'info' },
	{ status: 'stopping', label: 'Stopping', tone: 'warning' },
	{ status: 'idle', label: 'Ready', tone: undefined },
	{ status: 'stopped', label: 'Stopped', tone: undefined }
];

/** A full bay: three sections at real volume, with long names and state lines. */
export const baySections: BaySection[] = [
	{
		label: 'Needs you',
		attention: true,
		settled: false,
		strips: [
			{
				id: 'sandbox',
				status: 'waiting',
				name: 'Sandbox Pi sessions',
				agent: 'Pi',
				workspace: 'pau-sandbox',
				state: 'Allow write to crates/server/src/sessions.rs?',
				age: '4m'
			},
			{
				id: 'scope',
				status: 'waiting',
				name: 'Resource scope picker for project and global resources in one list',
				agent: 'Claude Code',
				workspace: 'pau-scope',
				state: 'Run pnpm install in packages/ui?',
				age: '9m'
			},
			{
				id: 'pty',
				status: 'failed',
				name: 'Terminal relay PTY',
				agent: 'Claude Code',
				workspace: 'pau-pty',
				state: 'Failed: srt exited with status 1',
				age: '6m'
			},
			{
				id: 'rpc',
				status: 'not_responding',
				name: 'Pi RPC timeout',
				agent: 'Pi',
				workspace: 'pau-rpc',
				state: 'Not responding for 1m',
				age: '1m'
			}
		]
	},
	{
		label: 'Running',
		attention: false,
		settled: false,
		strips: [
			{
				id: 'audit',
				status: 'running',
				name: 'Audit log shutdown drain',
				agent: 'Pi',
				workspace: 'pau',
				state: 'cargo test -p pau-server --lib audit::',
				age: '12s'
			},
			{
				id: 'boot',
				status: 'starting',
				name: 'Boot the sandbox extension',
				agent: 'Pi',
				workspace: 'pau-ext',
				state: 'Starting',
				age: '2s'
			}
		]
	},
	{
		label: 'Settled',
		attention: false,
		settled: true,
		strips: [
			{
				id: 'gutter',
				status: 'idle',
				name: 'Fix diff gutter',
				agent: 'Pi',
				workspace: 'pau',
				state: 'Ready',
				age: '1h'
			},
			{
				id: 'notes',
				status: 'stopping',
				name: 'Release notes draft',
				agent: 'Claude Code',
				workspace: 'pau-site',
				state: 'Stopping',
				age: '3h'
			},
			{
				id: 'docs',
				status: 'stopped',
				name: 'Website docs pass',
				agent: 'Pi',
				workspace: 'pau-site',
				state: 'Stopped',
				age: '2d'
			}
		]
	}
];

/** One-line row strips: changed files with mono paths and terminals. */
export const rowStrips: RowFixture[] = [
	{ id: 'sessions', icon: 'diffModified', name: 'crates/server/src/sessions.rs', meta: '+9 −1', mono: true },
	{
		id: 'long',
		icon: 'diffAdded',
		name: 'packages/ui/src/lib/resource-browser/scope-picker/ScopePickerOption.svelte',
		meta: '+148',
		mono: true
	},
	{ id: 'removed', icon: 'diffRemoved', name: 'apps/desktop/src/lib/legacy-rail.ts', meta: '−212', mono: true },
	{ id: 'terminal', icon: 'terminal', name: 'cargo watch', meta: 'running', mono: false }
];

/** Rows of a context menu, with a checked row, hints, keys and a disabled row. */
export const menuItems: MenuItemFixture[] = [
	{ label: 'Open', icon: 'file', keys: '↵' },
	{ label: 'Reveal in Finder', icon: 'files' },
	{ label: 'Copy path', icon: 'copy', hint: '/Users/operator/projects/pau/README.md' },
	{ label: 'Wrap long lines', icon: 'check', checked: true },
	{ label: 'Open in editor', icon: 'terminal', disabled: true, hint: 'Set an editor in Settings' }
];

/** A notice in each tone. */
export const notices: NoticeFixture[] = [
	{
		tone: 'info',
		icon: 'info',
		title: 'Pi 0.9 is available',
		body: 'Update from a terminal with `pi update`, then restart the session.',
		actions: ['Open terminal']
	},
	{
		tone: 'warning',
		icon: 'warning',
		title: 'Workspace not trusted yet',
		body: "Pi skips this workspace's project resources until you trust it with `/trust` in Pi. Review them here first.",
		actions: ['Review resources']
	},
	{
		tone: 'danger',
		icon: 'error',
		title: 'Pau could not start',
		body: 'Another process holds port 7421. Quit the other copy of Pau, then try again.',
		actions: ['Copy details', 'Try again']
	}
];

/** Output of a long command, the tail of which holds the result. */
export const longCommandOutput: string[] = [
	...Array.from({ length: 186 }, (_, index) => `   Compiling crate-${index + 1} v0.${index % 9}.${index % 4}`),
	'    Finished `test` profile [unoptimized + debuginfo] target(s) in 41.27s',
	'     Running unittests src/lib.rs (target/debug/deps/pau_server-5f1c)',
	'running 3 tests',
	'test audit::drains_queue_on_shutdown ... ok',
	'test audit::stops_after_five_seconds ... ok',
	'test audit::keeps_order_under_load ... ok',
	'test result: ok. 3 passed; 0 failed; 0 ignored; finished in 0.21s'
];

/** A long title, label or path for overflow states. */
export const longText = {
	title: 'Drain the audit log on shutdown so every queued record reaches disk before the server exits',
	label: 'Allow writes to every file under crates/server/src for this session',
	chip: 'claude/pau-297-strip-bay-foundation-in-the-shared-ui'
};
