import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** The first Claude Code release line supported by the bridge. */
export const MIN_SUPPORTED_CLAUDE_VERSION = "1.0.0" as const;

/** Claude Code major versions accepted by this bridge release. */
export const MAX_SUPPORTED_CLAUDE_MAJOR = 2 as const;

/** Structured Claude features available to later bridge lifecycle operations. */
export type ClaudeCapabilities = {
  readonly structuredInput: true;
  readonly structuredOutput: true;
  readonly nativeSessionResume: true;
  readonly interrupt: true;
};

/** Capabilities exposed by every supported Claude Code release. */
export const CLAUDE_CAPABILITIES: ClaudeCapabilities = Object.freeze({
  structuredInput: true,
  structuredOutput: true,
  nativeSessionResume: true,
  interrupt: true,
});

/** A parsed Claude Code version. */
export type ClaudeVersion = {
  readonly raw: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

/** The result of finding and inspecting a supported Claude Code executable. */
export type ClaudeDiscovery = {
  readonly executablePath: string;
  readonly version: ClaudeVersion;
  readonly capabilities: ClaudeCapabilities;
};

/** Overrides used while locating and inspecting Claude Code. */
export type DiscoverClaudeOptions = {
  /** An exact executable path. When set, PATH is not searched. */
  readonly executablePath?: string;
  /** The environment used for PATH lookup and the version process. */
  readonly env?: NodeJS.ProcessEnv;
  /** Maximum time allowed for `claude --version`. */
  readonly versionTimeoutMs?: number;
};

/** Machine-readable Claude discovery failures. */
export type ClaudeDiscoveryErrorCode =
  | "not_found"
  | "not_executable"
  | "version_failed"
  | "invalid_version"
  | "unsupported_version";

/** An actionable failure raised before any Claude session is started. */
export class ClaudeDiscoveryError extends Error {
  readonly code: ClaudeDiscoveryErrorCode;
  readonly executablePath?: string;
  readonly version?: ClaudeVersion;

  constructor(
    code: ClaudeDiscoveryErrorCode,
    message: string,
    details: { executablePath?: string; version?: ClaudeVersion; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "ClaudeDiscoveryError";
    this.code = code;
    this.executablePath = details.executablePath;
    this.version = details.version;
  }
}

const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;

/**
 * Locate Claude Code and inspect its version without starting a bridge session.
 */
export async function discoverClaude(
  options: DiscoverClaudeOptions = {},
): Promise<ClaudeDiscovery> {
  const env = options.env ?? process.env;
  const executablePath =
    options.executablePath !== undefined
      ? await validateConfiguredPath(options.executablePath)
      : await findOnPath(env.PATH);
  const output = await readVersion(
    executablePath,
    env,
    options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS,
  );
  const version = parseClaudeVersion(output, executablePath);

  if (version.major < 1 || version.major > MAX_SUPPORTED_CLAUDE_MAJOR) {
    throw new ClaudeDiscoveryError(
      "unsupported_version",
      `Claude Code ${version.raw} is unsupported. Install a version from ` +
        `${MIN_SUPPORTED_CLAUDE_VERSION} through ${MAX_SUPPORTED_CLAUDE_MAJOR}.x`,
      { executablePath, version },
    );
  }

  return { executablePath, version, capabilities: CLAUDE_CAPABILITIES };
}

async function validateConfiguredPath(executablePath: string): Promise<string> {
  try {
    const metadata = await stat(executablePath);
    if (!metadata.isFile()) {
      throw new ClaudeDiscoveryError(
        "not_executable",
        `Configured Claude path is not an executable file: ${executablePath}`,
        { executablePath },
      );
    }
    await access(executablePath, constants.X_OK);
    return executablePath;
  } catch (error) {
    if (error instanceof ClaudeDiscoveryError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT")) {
      throw new ClaudeDiscoveryError(
        "not_found",
        `Configured Claude executable does not exist: ${executablePath}`,
        { executablePath, cause: error },
      );
    }
    throw new ClaudeDiscoveryError(
      "not_executable",
      `Configured Claude path is not executable: ${executablePath}`,
      { executablePath, cause: error },
    );
  }
}

async function findOnPath(pathValue: string | undefined): Promise<string> {
  let blockedPath: string | undefined;

  for (const directory of (pathValue ?? "").split(delimiter)) {
    if (directory === "") {
      continue;
    }
    const candidate = join(directory, "claude");
    try {
      const metadata = await stat(candidate);
      if (!metadata.isFile()) {
        blockedPath ??= candidate;
        continue;
      }
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT") && !hasErrorCode(error, "ENOTDIR")) {
        blockedPath ??= candidate;
      }
    }
  }

  if (blockedPath) {
    throw new ClaudeDiscoveryError(
      "not_executable",
      `Claude was found on PATH but is not executable: ${blockedPath}`,
      { executablePath: blockedPath },
    );
  }
  throw new ClaudeDiscoveryError(
    "not_found",
    "Claude Code was not found; configure its executable path or add claude to PATH",
  );
}

function readVersion(
  executablePath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["--version"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const collect = (destination: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_VERSION_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      destination.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", (cause) => {
      clearTimeout(timer);
      reject(
        new ClaudeDiscoveryError(
          "version_failed",
          `Could not run Claude Code version check: ${executablePath}`,
          { executablePath, cause },
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new ClaudeDiscoveryError(
            "version_failed",
            `Claude Code version check timed out after ${timeoutMs}ms: ${executablePath}`,
            { executablePath },
          ),
        );
        return;
      }
      if (outputBytes > MAX_VERSION_OUTPUT_BYTES) {
        reject(
          new ClaudeDiscoveryError(
            "version_failed",
            `Claude Code version output exceeded ${MAX_VERSION_OUTPUT_BYTES} ` +
              `bytes: ${executablePath}`,
            { executablePath },
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new ClaudeDiscoveryError(
            "version_failed",
            `Claude Code version check exited with ${code ?? signal}: ${executablePath}`,
            { executablePath },
          ),
        );
        return;
      }
      resolve(Buffer.concat([...stdout, ...stderr]).toString("utf8").trim());
    });
  });
}

function parseClaudeVersion(output: string, executablePath: string): ClaudeVersion {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?=\s|$)/.exec(output);
  if (!match) {
    throw new ClaudeDiscoveryError(
      "invalid_version",
      `Claude Code returned an unrecognized version: ${output || "(empty output)"}`,
      { executablePath },
    );
  }

  return {
    raw: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
