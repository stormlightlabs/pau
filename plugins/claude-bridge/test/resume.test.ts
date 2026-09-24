import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClaudeProcessRegistry,
  discoverClaude,
} from "../src/index.js";

const fakeClaude = fileURLToPath(
  new URL("./fixtures/fake-claude.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];
const registries: ClaudeProcessRegistry[] = [];

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.stopAll()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Claude native session resume", () => {
  it("captures, stops, and resumes a native session", async () => {
    const cwd = await makeTemporaryDirectory();
    const sessionFile = join(cwd, "native-session-id");
    const discovery = await discoverClaude({ executablePath: fakeClaude });
    const registry = makeRegistry();
    const env = {
      ...globalThis.process.env,
      FAKE_CLAUDE_MODE: "stream",
      FAKE_CLAUDE_SESSION_FILE: sessionFile,
    };
    const initialProcess = await registry.start({ discovery, cwd, env });

    const initialCompletion = await initialProcess.prompt("Start a session");

    expect(initialCompletion.sessionId).toBe("session-fixture");
    expect(initialProcess.nativeSessionId).toBe("session-fixture");
    await initialProcess.stop();

    const resumedProcess = await registry.resume({
      discovery,
      cwd,
      env,
      nativeSessionId: initialCompletion.sessionId!,
    });
    const resumedCompletion = await resumedProcess.prompt("Continue the session");

    expect(resumedCompletion).toMatchObject({
      status: "completed",
      sessionId: "session-fixture",
    });
    expect(resumedProcess.nativeSessionId).toBe("session-fixture");
  });

  it("reports an unknown native session as recoverable", async () => {
    const cwd = await makeTemporaryDirectory();
    const registry = makeRegistry();
    const resumedProcess = await registry.resume({
      discovery: await discoverClaude({ executablePath: fakeClaude }),
      cwd,
      env: {
        ...globalThis.process.env,
        FAKE_CLAUDE_MODE: "stream",
        FAKE_CLAUDE_SESSION_FILE: join(cwd, "missing-session-store"),
      },
      nativeSessionId: "unknown-session",
    });

    await expect(resumedProcess.prompt("Continue")).rejects.toMatchObject({
      name: "ClaudeResumeError",
      code: "unknown_session",
      recoverable: true,
      requestedSessionId: "unknown-session",
    });
  });

  it("reports a mismatched native session as recoverable", async () => {
    const cwd = await makeTemporaryDirectory();
    const sessionFile = join(cwd, "native-session-id");
    const discovery = await discoverClaude({ executablePath: fakeClaude });
    const registry = makeRegistry();
    const env = {
      ...globalThis.process.env,
      FAKE_CLAUDE_MODE: "stream",
      FAKE_CLAUDE_SESSION_FILE: sessionFile,
    };
    const initialProcess = await registry.start({ discovery, cwd, env });
    await initialProcess.prompt("Start a session");
    await initialProcess.stop();

    const resumedProcess = await registry.resume({
      discovery,
      cwd,
      env: {
        ...env,
        FAKE_CLAUDE_RESUME_RESULT_ID: "different-session",
      },
      nativeSessionId: "session-fixture",
    });

    await expect(resumedProcess.prompt("Continue")).rejects.toMatchObject({
      name: "ClaudeResumeError",
      code: "session_mismatch",
      recoverable: true,
      requestedSessionId: "session-fixture",
      actualSessionId: "different-session",
    });
  });
});

function makeRegistry(): ClaudeProcessRegistry {
  const registry = new ClaudeProcessRegistry();
  registries.push(registry);
  return registry;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pau-claude-resume-"));
  temporaryDirectories.push(directory);
  return directory;
}
