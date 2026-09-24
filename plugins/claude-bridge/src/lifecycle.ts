import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";

import type { ClaudeDiscovery } from "./discovery.js";
import {
  ClaudePromptError,
  runClaudePrompt,
  type ClaudePromptHandlers,
  type ClaudeTurnCompletion,
} from "./streaming.js";

/** Arguments that keep Claude on structured stdin and stdout. */
export const CLAUDE_STRUCTURED_ARGS = Object.freeze([
  "--print",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--include-partial-messages",
  "--verbose",
] as const);

/** Observable states of one owned Claude process. */
export type ClaudeProcessState =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

/** The furthest shutdown action sent to Claude. */
export type ClaudeShutdownStage =
  | "protocol"
  | "interrupt"
  | "terminate"
  | "kill";

/** Timing for each step of a staged shutdown. */
export type ClaudeShutdownTimeouts = {
  readonly protocolMs: number;
  readonly interruptMs: number;
  readonly terminateMs: number;
  readonly killMs: number;
};

/** Final information reported after a Claude process exits. */
export type ClaudeProcessExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly expected: boolean;
  readonly shutdownStage: ClaudeShutdownStage | null;
};

/** Options for starting one discovered Claude executable. */
export type StartClaudeProcessOptions = {
  readonly discovery: ClaudeDiscovery;
  readonly cwd: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly shutdownTimeouts?: Partial<ClaudeShutdownTimeouts>;
  readonly id?: string;
};

/** Machine-readable process lifecycle failures. */
export type ClaudeProcessErrorCode = "start_failed" | "kill_timeout";

/** A failure to start or stop an owned Claude process. */
export class ClaudeProcessError extends Error {
  readonly code: ClaudeProcessErrorCode;
  readonly processId: string;

  constructor(
    code: ClaudeProcessErrorCode,
    processId: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ClaudeProcessError";
    this.code = code;
    this.processId = processId;
  }
}

const DEFAULT_SHUTDOWN_TIMEOUTS: ClaudeShutdownTimeouts = Object.freeze({
  protocolMs: 2_000,
  interruptMs: 2_000,
  terminateMs: 2_000,
  killMs: 2_000,
});

/**
 * One Claude child process and its structured streams.
 *
 * Use {@link ClaudeProcessRegistry.start} rather than constructing this class.
 */
export class ClaudeProcess {
  readonly id: string;
  readonly executablePath: string;
  readonly cwd: string;
  readonly input: Writable;
  readonly output: Readable;
  readonly diagnostics: Readable;
  readonly exit: Promise<ClaudeProcessExit>;

  readonly #child: ChildProcessWithoutNullStreams;
  readonly #timeouts: ClaudeShutdownTimeouts;
  readonly #started: Promise<void>;
  #resolveExit!: (exit: ClaudeProcessExit) => void;
  #state: ClaudeProcessState = "starting";
  #exitInfo: ClaudeProcessExit | undefined;
  #shutdownStage: ClaudeShutdownStage | null = null;
  #stopPromise: Promise<ClaudeProcessExit> | undefined;
  #promptActive = false;
  #nextEventSequence = 0;

  /** @internal Processes are owned and created by a registry. */
  constructor(options: StartClaudeProcessOptions, onExit: () => void) {
    this.id = options.id ?? randomUUID();
    this.executablePath = options.discovery.executablePath;
    this.cwd = options.cwd;
    this.#timeouts = { ...DEFAULT_SHUTDOWN_TIMEOUTS, ...options.shutdownTimeouts };
    validateTimeouts(this.#timeouts);

    this.#child = spawn(
      this.executablePath,
      [...(options.args ?? CLAUDE_STRUCTURED_ARGS)],
      {
        cwd: this.cwd,
        env: options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.input = this.#child.stdin;
    this.output = this.#child.stdout;
    this.diagnostics = this.#child.stderr;
    this.exit = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });

    this.#started = new Promise((resolve, reject) => {
      this.#child.once("spawn", () => {
        this.#state = "running";
        resolve();
      });
      this.#child.once("error", (cause) => {
        if (this.#state === "starting") {
          reject(
            new ClaudeProcessError(
              "start_failed",
              this.id,
              `Could not start Claude Code: ${this.executablePath}`,
              cause,
            ),
          );
        }
      });
    });

    this.#child.once("close", (code, signal) => {
      const expected = this.#state === "stopping";
      this.#exitInfo = {
        code,
        signal,
        expected,
        shutdownStage: expected ? this.#shutdownStage : null,
      };
      this.#state = expected ? "stopped" : "failed";
      onExit();
      this.#resolveExit(this.#exitInfo);
    });
  }

  /** Current process state. */
  get state(): ClaudeProcessState {
    return this.#state;
  }

  /** Operating-system process identifier, once the process has started. */
  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** Final exit information, or undefined while the process is live. */
  get exitInfo(): ClaudeProcessExit | undefined {
    return this.#exitInfo;
  }

  /** Wait until the operating system has started the child process. */
  async waitUntilStarted(): Promise<void> {
    await this.#started;
  }

  /**
   * Send one task and resolve only when Claude emits its authoritative result.
   * Text and tool records are delivered through the handlers as they arrive.
   */
  async prompt(
    task: string,
    handlers: ClaudePromptHandlers = {},
  ): Promise<ClaudeTurnCompletion> {
    if (this.#promptActive) {
      throw new ClaudePromptError(
        "prompt_in_progress",
        "A Claude prompt is already in progress",
      );
    }
    if (this.#state !== "running") {
      throw new ClaudePromptError(
        "process_exited",
        "Claude is not running",
      );
    }

    this.#promptActive = true;
    try {
      const result = await runClaudePrompt(
        this,
        task,
        this.#nextEventSequence,
        handlers,
      );
      this.#nextEventSequence = result.nextSequence;
      return result.completion;
    } finally {
      this.#promptActive = false;
    }
  }

  /**
   * Stop Claude by closing structured input, then escalating through SIGINT,
   * SIGTERM, and SIGKILL when each preceding stage times out.
   */
  stop(): Promise<ClaudeProcessExit> {
    if (this.#exitInfo) {
      return Promise.resolve(this.#exitInfo);
    }
    this.#stopPromise ??= this.#runShutdown();
    return this.#stopPromise;
  }

  async #runShutdown(): Promise<ClaudeProcessExit> {
    this.#state = "stopping";

    this.#shutdownStage = "protocol";
    this.#child.stdin.end();
    let exit = await waitForExit(this.exit, this.#timeouts.protocolMs);
    if (exit) return exit;

    this.#shutdownStage = "interrupt";
    this.#child.kill("SIGINT");
    exit = await waitForExit(this.exit, this.#timeouts.interruptMs);
    if (exit) return exit;

    this.#shutdownStage = "terminate";
    this.#child.kill("SIGTERM");
    exit = await waitForExit(this.exit, this.#timeouts.terminateMs);
    if (exit) return exit;

    this.#shutdownStage = "kill";
    this.#child.kill("SIGKILL");
    exit = await waitForExit(this.exit, this.#timeouts.killMs);
    if (exit) return exit;

    throw new ClaudeProcessError(
      "kill_timeout",
      this.id,
      `Claude Code did not exit after SIGKILL: ${this.id}`,
    );
  }
}

/** Owns all Claude processes started through one bridge instance. */
export class ClaudeProcessRegistry {
  readonly #processes = new Map<string, ClaudeProcess>();

  /** Number of processes that have not exited. */
  get size(): number {
    return this.#processes.size;
  }

  /** Start Claude in the selected working directory and register it as live. */
  async start(options: StartClaudeProcessOptions): Promise<ClaudeProcess> {
    const processId = options.id ?? randomUUID();
    if (this.#processes.has(processId)) {
      throw new Error(`A Claude process already uses ID: ${processId}`);
    }

    const process = new ClaudeProcess(
      { ...options, id: processId },
      () => this.#processes.delete(processId),
    );
    this.#processes.set(processId, process);

    try {
      await process.waitUntilStarted();
      return process;
    } catch (error) {
      this.#processes.delete(processId);
      throw error;
    }
  }

  /** Return a live process by its stable bridge identifier. */
  get(processId: string): ClaudeProcess | undefined {
    return this.#processes.get(processId);
  }

  /** Return a snapshot of all live processes. */
  list(): readonly ClaudeProcess[] {
    return [...this.#processes.values()];
  }

  /** Stop every process that remains registered during shutdown. */
  async stopAll(): Promise<void> {
    while (this.#processes.size > 0) {
      await Promise.all([...this.#processes.values()].map((process) => process.stop()));
    }
  }
}

function validateTimeouts(timeouts: ClaudeShutdownTimeouts): void {
  for (const [name, value] of Object.entries(timeouts)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Shutdown timeout ${name} must be a non-negative number`);
    }
  }
}

async function waitForExit(
  exitPromise: Promise<ClaudeProcessExit>,
  timeoutMs: number,
): Promise<ClaudeProcessExit | undefined> {
  let timer: NodeJS.Timeout | number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const result = await Promise.race([exitPromise, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}
