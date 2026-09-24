import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_CAPABILITIES,
  ClaudeDiscoveryError,
  discoverClaude,
} from "../src/index.js";

const fakeClaude = fileURLToPath(
  new URL("./fixtures/fake-claude.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Claude discovery", () => {
  it("uses a configured executable path and reports capabilities", async () => {
    const result = await discoverClaude({ executablePath: fakeClaude });

    expect(result).toEqual({
      executablePath: fakeClaude,
      version: { raw: "2.1.3", major: 2, minor: 1, patch: 3 },
      capabilities: CLAUDE_CAPABILITIES,
    });
  });

  it("finds the claude executable on PATH", async () => {
    const directory = await makeTemporaryDirectory();
    const executablePath = join(directory, "claude");
    await symlink(fakeClaude, executablePath);

    const result = await discoverClaude({
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    expect(result.executablePath).toBe(executablePath);
    expect(result.version.raw).toBe("2.1.3");
  });

  it("reports a missing configured executable", async () => {
    const executablePath = join(await makeTemporaryDirectory(), "missing-claude");

    await expectDiscoveryError(
      discoverClaude({ executablePath }),
      "not_found",
      executablePath,
    );
  });

  it("reports a missing PATH executable", async () => {
    await expectDiscoveryError(
      discoverClaude({ env: { ...process.env, PATH: "" } }),
      "not_found",
    );
  });

  it("rejects a non-executable file on PATH", async () => {
    const directory = await makeTemporaryDirectory();
    const executablePath = join(directory, "claude");
    await writeFile(executablePath, "#!/bin/sh\necho '2.1.3 (Claude Code)'\n");
    await chmod(executablePath, 0o644);

    await expectDiscoveryError(
      discoverClaude({ env: { ...process.env, PATH: directory } }),
      "not_executable",
      executablePath,
    );
  });

  it("rejects unsupported Claude versions reported by the fixture", async () => {
    const promise = discoverClaude({
      executablePath: fakeClaude,
      env: { ...process.env, FAKE_CLAUDE_VERSION: "3.0.0 (Claude Code)" },
    });

    const error = await expectDiscoveryError(
      promise,
      "unsupported_version",
      fakeClaude,
    );
    expect(error.version).toEqual({
      raw: "3.0.0",
      major: 3,
      minor: 0,
      patch: 0,
    });
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pau-claude-discovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function expectDiscoveryError(
  promise: Promise<unknown>,
  code: ClaudeDiscoveryError["code"],
  executablePath?: string,
): Promise<ClaudeDiscoveryError> {
  try {
    await promise;
    throw new Error("Expected Claude discovery to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeDiscoveryError);
    const discoveryError = error as ClaudeDiscoveryError;
    expect(discoveryError.code).toBe(code);
    expect(discoveryError.executablePath).toBe(executablePath);
    return discoveryError;
  }
}
