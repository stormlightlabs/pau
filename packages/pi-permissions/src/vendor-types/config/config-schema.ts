/**
 * Local definitions of the upstream configuration types that the vendored
 * analysis imports from `#src/config/config-schema`.
 *
 * Upstream infers these types from a Zod schema. Pau validates its own policy
 * file with Valibot and never loads upstream configuration, so it resolves that
 * import here instead of adding Zod or editing vendored files. The shapes match
 * upstream release 40.3.0; a vendor sync must recheck them.
 */

/** A rule action. */
export type PermissionState = 'allow' | 'deny' | 'ask';

/** A deny with a reason passed to the agent. */
export type DenyWithReason = { action: 'deny'; reason?: string };

/** One pattern's value in a permission map. */
export type PatternValue = PermissionState | DenyWithReason;

/** Upstream's flat permission map, keyed by surface. */
export type FlatPermissionConfig = Record<string, PermissionState | Record<string, PatternValue>>;

/** A tool that carries shell semantics under another name. */
export type ShellToolsConfig = Record<string, { commandArgument: string; workdirArgument?: string }>;

/** A declared filesystem effect. */
type DeclaredEffect = 'read' | 'write';

/** What a command does to the paths it is given. */
export type CommandEffectsEntry = {
	effects?: DeclaredEffect | DeclaredEffect[];
	unlessOption?: string[];
	subcommands?: Record<string, CommandEffectsEntry | DeclaredEffect | DeclaredEffect[]>;
};

/** Declared command effects keyed by command basename. */
export type CommandEffectsConfig = Record<string, CommandEffectsEntry>;
