import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  discoverClaude,
  type ClaudeDiscovery,
} from "./discovery.js";
import {
  CLAUDE_STRUCTURED_ARGS,
  ClaudeProcess,
  ClaudeProcessRegistry,
} from "./lifecycle.js";
import type {
  ClaudePromptHandlers,
  ClaudeTurnCompletion,
} from "./streaming.js";
import type { EventFrame } from "./protocol.js";

/** Claude permission and task behavior selected for one process. */
export type ClaudeExecutionProfile =
  | "work"
  | "review"
  | "review-with-checks";

/** Claude configuration sources available to one process. */
export type ClaudeConfigurationMode = "native" | "safe";

/** Configuration for the Pi-facing Claude extension. */
export type ClaudePiExtensionOptions = {
  readonly executablePath?: string;
  readonly configurationMode?: ClaudeConfigurationMode;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly checkCommands?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};

/** State recorded in the Pi session without copying Claude's transcript. */
export type ClaudeSessionMetadata = {
  readonly nativeSessionId: string;
};

/** Structured details returned by the model-callable delegation tool. */
export type ClaudeDelegationDetails = {
  readonly profile: ClaudeExecutionProfile;
  readonly completion: ClaudeTurnCompletion;
  readonly events: readonly EventFrame[];
  readonly truncated: boolean;
};

const TOOL_NAME = "claude_delegate";
const SESSION_ENTRY_TYPE = "pau-claude-session";
const DEFAULT_MAX_TURNS = 20;
const MAX_RESULT_CHARACTERS = 8_000;
const DEFAULT_CHECK_COMMANDS = Object.freeze([
  "git diff",
  "git status",
  "pnpm test",
  "pnpm check",
  "npm test",
  "cargo test",
] as const);
const PROFILES = new Set<ClaudeExecutionProfile>([
  "work",
  "review",
  "review-with-checks",
]);

const DELEGATE_PARAMETERS = Type.Object({
  task: Type.String({ description: "Focused task for Claude Code" }),
  profile: Type.Optional(
    Type.Union([
      Type.Literal("work"),
      Type.Literal("review"),
      Type.Literal("review-with-checks"),
    ], { description: "Execution profile. Defaults to work." }),
  ),
});

type ExtensionState = {
  discovery?: ClaudeDiscovery;
  process?: ClaudeProcess;
  profile?: ClaudeExecutionProfile;
  rememberedSessionId?: string;
  persistedSessionId?: string;
  delegationEnabled: boolean;
};

/** Build the Claude CLI arguments for one execution profile. */
export function buildClaudeArguments(
  profile: ClaudeExecutionProfile,
  options: Required<Pick<ClaudePiExtensionOptions, "configurationMode" | "maxTurns">> &
    Pick<ClaudePiExtensionOptions, "maxBudgetUsd" | "checkCommands">,
): string[] {
  const args: string[] = [...CLAUDE_STRUCTURED_ARGS];

  if (options.configurationMode === "safe") {
    args.push("--safe-mode");
  }

  if (profile === "review") {
    args.push(
      "--permission-mode",
      "plan",
      "--permission-prompts",
      "none",
      "--tools",
      "Read,Grep,Glob,WebFetch,WebSearch",
    );
  } else if (profile === "review-with-checks") {
    const allowedChecks = (options.checkCommands ?? DEFAULT_CHECK_COMMANDS)
      .map((command) => `Bash(${command}:*)`);
    args.push(
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--tools",
      "Read,Grep,Glob,WebFetch,WebSearch,Bash",
      "--allowedTools",
      allowedChecks.join(","),
    );
  } else {
    // The direct stream transport has no Pi permission callback. acceptEdits
    // handles file edits automatically and denies requests that still need UI.
    args.push(
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
    );
  }

  args.push("--max-turns", String(options.maxTurns));
  if (options.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(options.maxBudgetUsd));
  }
  return args;
}

/** Create the extension factory with explicit options for tests and embedding. */
export function createClaudePiExtension(
  suppliedOptions: ClaudePiExtensionOptions = {},
): (pi: ExtensionAPI) => void {
  const options = normalizeOptions(suppliedOptions);

  return (pi: ExtensionAPI): void => {
    const registry = new ClaudeProcessRegistry();
    const state: ExtensionState = { delegationEnabled: false };

    const rememberSession = (): void => {
      const nativeSessionId = state.process?.nativeSessionId;
      if (!nativeSessionId || nativeSessionId === state.persistedSessionId) return;
      state.rememberedSessionId = nativeSessionId;
      state.persistedSessionId = nativeSessionId;
      pi.appendEntry<ClaudeSessionMetadata>(SESSION_ENTRY_TYPE, { nativeSessionId });
    };

    const stop = async (): Promise<void> => {
      rememberSession();
      await state.process?.stop();
      state.process = undefined;
      state.profile = undefined;
    };

    const getDiscovery = async (): Promise<ClaudeDiscovery> => {
      state.discovery ??= await discoverClaude({
        executablePath: options.executablePath,
        env: options.env,
      });
      return state.discovery;
    };

    const warnIfUnverified = async (ctx: ExtensionContext): Promise<void> => {
      const warning = (await getDiscovery()).warning;
      if (warning) ctx.ui.notify(warning, "warning");
    };

    const start = async (
      cwd: string,
      profile: ClaudeExecutionProfile,
      nativeSessionId?: string,
    ): Promise<ClaudeProcess> => {
      if (state.process) throw new Error("Claude is already running");
      const processOptions = {
        discovery: await getDiscovery(),
        cwd,
        args: buildClaudeArguments(profile, options),
        env: options.env,
      };
      state.process = nativeSessionId
        ? await registry.resume({ ...processOptions, nativeSessionId })
        : await registry.start(processOptions);
      state.profile = profile;
      if (nativeSessionId) state.rememberedSessionId = nativeSessionId;
      return state.process;
    };

    const ensureProfile = async (
      cwd: string,
      profile: ClaudeExecutionProfile,
    ): Promise<ClaudeProcess> => {
      if (!state.process) return start(cwd, profile);
      if (state.profile === profile) return state.process;

      const nativeSessionId = state.process.nativeSessionId;
      await stop();
      return start(cwd, profile, nativeSessionId);
    };

    const runTask = async (
      task: string,
      profile: ClaudeExecutionProfile,
      cwd: string,
      handlers: ClaudePromptHandlers = {},
    ): Promise<{ completion: ClaudeTurnCompletion; events: EventFrame[] }> => {
      if (task.trim() === "") throw new Error("Claude task must not be empty");
      const events: EventFrame[] = [];
      const process = await ensureProfile(cwd, profile);
      const completion = await process.prompt(task, {
        onEvent: (event) => {
          events.push(event);
          handlers.onEvent?.(event);
        },
        onDiagnostic: handlers.onDiagnostic,
      });
      rememberSession();
      return { completion, events };
    };

    const notifyTaskEvent = (
      event: EventFrame,
      ctx: ExtensionContext,
    ): void => {
      if (event.event === "tool.started") {
        const payload = event.payload as { name?: unknown };
        ctx.ui.notify(`Claude started ${String(payload.name ?? "a tool")}`, "info");
      } else if (event.event === "tool.completed") {
        ctx.ui.notify("Claude tool finished", "info");
      }
    };

    const runCommandTask = async (
      task: string,
      profile: ClaudeExecutionProfile,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      const { completion } = await runTask(task, profile, ctx.cwd, {
        onEvent: (event) => notifyTaskEvent(event, ctx),
        onDiagnostic: (diagnostic) => {
          if (diagnostic.level === "warn" || diagnostic.level === "error") {
            ctx.ui.notify(`Claude: ${diagnostic.message}`, "warning");
          }
        },
      });
      const text = formatCompletion(completion).text;
      pi.sendMessage({
        customType: "pau-claude-result",
        content: text,
        display: true,
        details: { profile, completion },
      });
    };

    pi.registerCommand("claude-discover", {
      description: "Find Claude Code and report bridge capabilities",
      handler: async (_args, ctx) => {
        const discovery = await getDiscovery();
        if (discovery.warning) ctx.ui.notify(discovery.warning, "warning");
        ctx.ui.notify(
          `Claude Code ${discovery.version.raw} at ${discovery.executablePath}; ` +
            "streaming, interrupt, and native resume available",
          "info",
        );
      },
    });

    pi.registerCommand("claude-start", {
      description: "Start Claude Code: /claude-start [work|review|review-with-checks]",
      handler: async (args, ctx) => {
        const profile = parseProfile(args, "work");
        await warnIfUnverified(ctx);
        await start(ctx.cwd, profile);
        ctx.ui.notify(`Claude started with the ${profile} profile`, "info");
      },
    });

    pi.registerCommand("claude-new", {
      description: "Stop the current Claude process and start a new session",
      handler: async (args, ctx) => {
        const profile = parseProfile(args, "work");
        await warnIfUnverified(ctx);
        await stop();
        state.rememberedSessionId = undefined;
        state.persistedSessionId = undefined;
        await start(ctx.cwd, profile);
        ctx.ui.notify(`New Claude session started with the ${profile} profile`, "info");
      },
    });

    pi.registerCommand("claude-resume", {
      description: "Explicitly resume a native Claude session: /claude-resume [id] [profile]",
      handler: async (args, ctx) => {
        const words = args.trim().split(/\s+/).filter(Boolean);
        const profileWord = words.at(-1);
        const profile = profileWord && PROFILES.has(profileWord as ClaudeExecutionProfile)
          ? profileWord as ClaudeExecutionProfile
          : "work";
        if (profileWord === profile) words.pop();
        const nativeSessionId = words.join(" ") || state.rememberedSessionId;
        if (!nativeSessionId) {
          throw new Error("No Claude session ID is recorded; pass one to /claude-resume");
        }
        await warnIfUnverified(ctx);
        await stop();
        await start(ctx.cwd, profile, nativeSessionId);
        ctx.ui.notify(`Claude session ${nativeSessionId} is ready to resume`, "info");
      },
    });

    for (const command of [
      ["claude-work", "Run focused Claude work", "work"],
      ["claude-review", "Run a strict read-only Claude review", "review"],
      [
        "claude-review-checks",
        "Run a read-only Claude review with allowlisted checks",
        "review-with-checks",
      ],
    ] as const) {
      pi.registerCommand(command[0], {
        description: `${command[1]}: /${command[0]} <task>`,
        handler: async (args, ctx) => {
          await warnIfUnverified(ctx);
          await runCommandTask(args, command[2], ctx);
        },
      });
    }

    pi.registerCommand("claude-status", {
      description: "Show Claude process, session, profile, and limit status",
      handler: async (_args, ctx) => {
        const process = state.process;
        const budget = options.maxBudgetUsd === undefined
          ? "no dollar budget"
          : `$${options.maxBudgetUsd} budget`;
        ctx.ui.notify(
          process
            ? `Claude ${process.state}; profile ${state.profile}; session ` +
              `${process.nativeSessionId ?? "pending"}; ${options.maxTurns} turns; ${budget}; ` +
              `delegation ${state.delegationEnabled ? "enabled" : "disabled"}`
            : `Claude stopped; recorded session ${state.rememberedSessionId ?? "none"}; ` +
              `delegation ${state.delegationEnabled ? "enabled" : "disabled"}`,
          "info",
        );
      },
    });

    pi.registerCommand("claude-interrupt", {
      description: "Interrupt Claude's active turn without stopping its process",
      handler: async (_args, ctx) => {
        if (!state.process) throw new Error("Claude is not running");
        const completion = await state.process.interrupt();
        ctx.ui.notify(`Claude turn ${completion.status}`, "info");
      },
    });

    pi.registerCommand("claude-stop", {
      description: "Stop the current Claude process",
      handler: async (_args, ctx) => {
        await stop();
        ctx.ui.notify("Claude stopped", "info");
      },
    });

    pi.registerCommand("claude-delegation", {
      description: "Enable or disable the claude_delegate tool for this Pi session",
      handler: async (args, ctx) => {
        const action = args.trim();
        if (action !== "enable" && action !== "disable") {
          throw new Error("Usage: /claude-delegation enable|disable");
        }
        state.delegationEnabled = action === "enable";
        setToolActive(pi, state.delegationEnabled);
        ctx.ui.notify(`Claude delegation ${action}d for this Pi session`, "info");
      },
    });

    pi.registerTool({
      name: TOOL_NAME,
      label: "Delegate to Claude",
      description: "Delegate one focused task to the operator-enabled Claude Code session.",
      promptSnippet: "Delegate a bounded task to Claude Code when the operator has enabled delegation.",
      parameters: DELEGATE_PARAMETERS,
      async execute(_toolCallId, parameters, signal, onUpdate, ctx) {
        if (!state.delegationEnabled) {
          throw new Error("Claude delegation is disabled; the operator must enable it");
        }
        if (signal?.aborted) throw new Error("Claude delegation was aborted");
        await warnIfUnverified(ctx);

        const profile = parameters.profile ?? "work";
        const events: EventFrame[] = [];
        const onAbort = (): void => {
          void state.process?.interrupt().catch(() => {});
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const result = await runTask(parameters.task, profile, ctx.cwd, {
            onEvent: (event) => {
              events.push(event);
              if (event.event === "tool.started" || event.event === "tool.completed") {
                onUpdate?.({
                  content: [{ type: "text", text: summarizeEvent(event) }],
                  details: { profile, events: [...events] },
                });
              }
            },
          });
          const formatted = formatCompletion(result.completion);
          return {
            content: [{ type: "text", text: formatted.text }],
            details: {
              profile,
              completion: result.completion,
              events: result.events,
              truncated: formatted.truncated,
            } satisfies ClaudeDelegationDetails,
          };
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      },
    });

    pi.on("session_start", (_event, ctx) => {
      state.delegationEnabled = false;
      setToolActive(pi, false);
      state.rememberedSessionId = findRememberedSessionId(
        ctx.sessionManager.getBranch(),
      );
      state.persistedSessionId = state.rememberedSessionId;
    });

    pi.on("session_shutdown", async () => {
      state.delegationEnabled = false;
      setToolActive(pi, false);
      await registry.stopAll();
      state.process = undefined;
      state.profile = undefined;
    });
  };
}

/** Pi package entry point. */
export default createClaudePiExtension(optionsFromEnvironment(process.env));

function normalizeOptions(
  options: ClaudePiExtensionOptions,
): Required<Pick<ClaudePiExtensionOptions, "configurationMode" | "maxTurns" | "env">> &
  Pick<ClaudePiExtensionOptions, "executablePath" | "maxBudgetUsd" | "checkCommands"> {
  const configurationMode = options.configurationMode ?? "native";
  if (configurationMode !== "native" && configurationMode !== "safe") {
    throw new Error(`Unknown Claude configuration mode: ${configurationMode}`);
  }
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    throw new Error("Claude max turns must be a positive integer");
  }
  if (
    options.maxBudgetUsd !== undefined &&
    (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0)
  ) {
    throw new Error("Claude dollar budget must be a positive number");
  }
  return {
    ...options,
    configurationMode,
    maxTurns,
    env: options.env ?? process.env,
  };
}

function optionsFromEnvironment(env: NodeJS.ProcessEnv): ClaudePiExtensionOptions {
  return {
    executablePath: env.PAU_CLAUDE_PATH || undefined,
    configurationMode: env.PAU_CLAUDE_CONFIG_MODE as ClaudeConfigurationMode | undefined,
    maxTurns: parseOptionalNumber(env.PAU_CLAUDE_MAX_TURNS),
    maxBudgetUsd: parseOptionalNumber(env.PAU_CLAUDE_MAX_BUDGET_USD),
    checkCommands: env.PAU_CLAUDE_CHECK_COMMANDS
      ?.split(";")
      .map((command) => command.trim())
      .filter(Boolean),
    env,
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  return value === undefined || value === "" ? undefined : Number(value);
}

function parseProfile(
  value: string,
  fallback: ClaudeExecutionProfile,
): ClaudeExecutionProfile {
  const profile = value.trim() || fallback;
  if (!PROFILES.has(profile as ClaudeExecutionProfile)) {
    throw new Error(`Unknown Claude profile: ${profile}`);
  }
  return profile as ClaudeExecutionProfile;
}

function setToolActive(pi: ExtensionAPI, active: boolean): void {
  const names = pi.getActiveTools().filter((name) => name !== TOOL_NAME);
  if (active) names.push(TOOL_NAME);
  pi.setActiveTools(names);
}

function findRememberedSessionId(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.type === "custom" &&
      entry.customType === SESSION_ENTRY_TYPE &&
      typeof entry.data === "object" &&
      entry.data !== null &&
      "nativeSessionId" in entry.data &&
      typeof entry.data.nativeSessionId === "string"
    ) {
      return entry.data.nativeSessionId;
    }
  }
  return undefined;
}

function formatCompletion(
  completion: ClaudeTurnCompletion,
): { text: string; truncated: boolean } {
  const result = completion.result ?? completion.error ?? `Claude turn ${completion.status}`;
  const limits = [
    completion.turns === undefined ? undefined : `${completion.turns} turns`,
    completion.costUsd === undefined ? undefined : `$${completion.costUsd.toFixed(4)}`,
  ].filter(Boolean).join(", ");
  const suffix = limits ? `\n\nClaude reported: ${limits}.` : "";
  if (result.length <= MAX_RESULT_CHARACTERS) {
    return { text: result + suffix, truncated: false };
  }
  return {
    text: result.slice(0, MAX_RESULT_CHARACTERS) +
      `\n\n[Claude result truncated at ${MAX_RESULT_CHARACTERS} characters.]` + suffix,
    truncated: true,
  };
}

function summarizeEvent(event: EventFrame): string {
  if (event.event === "tool.started") {
    const payload = event.payload as { name?: unknown };
    return `Claude started ${String(payload.name ?? "a tool")}`;
  }
  return "Claude tool finished";
}
