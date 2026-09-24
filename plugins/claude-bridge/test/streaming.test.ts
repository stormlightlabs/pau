import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClaudeProcessRegistry,
  discoverClaude,
  type DiagnosticFrame,
  type EventFrame,
} from "../src/index.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fakeClaude = join(fixtures, "fake-claude.mjs");
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

describe("Claude prompt streaming", () => {
  it("streams partial records in order and trusts the result", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pau-claude-streaming-"));
    temporaryDirectories.push(cwd);
    const registry = new ClaudeProcessRegistry();
    registries.push(registry);
    const process = await registry.start({
      discovery: await discoverClaude({ executablePath: fakeClaude }),
      cwd,
      env: {
        ...globalThis.process.env,
        FAKE_CLAUDE_MODE: "stream",
        FAKE_CLAUDE_STREAM_FIXTURE: join(fixtures, "claude-stream.jsonl"),
        FAKE_CLAUDE_DIAGNOSTIC_FIXTURE: join(
          fixtures,
          "claude-diagnostics.log",
        ),
      },
    });
    const events: EventFrame[] = [];
    const diagnostics: DiagnosticFrame[] = [];

    const completion = await process.prompt("Inspect the fixture", {
      onEvent: (event) => events.push(event),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(events.map(({ sequence, event }) => ({ sequence, event }))).toEqual([
      { sequence: 0, event: "text.delta" },
      { sequence: 1, event: "text.delta" },
      { sequence: 2, event: "tool.started" },
      { sequence: 3, event: "tool.completed" },
      { sequence: 4, event: "turn.completed" },
    ]);
    expect(events[0]?.payload).toEqual({ text: "Checking " });
    expect(events[2]?.payload).toEqual({
      id: "tool-1",
      name: "Read",
      input: { path: "README.md" },
    });
    expect(events[3]?.payload).toEqual({
      id: "tool-1",
      content: "file contents",
      isError: false,
    });
    expect(completion).toEqual({
      status: "completed",
      result: "Done",
      sessionId: "session-fixture",
      turns: 3,
      costUsd: 0.0123,
    });
    expect(events.at(-1)?.payload).toEqual(completion);
    expect(diagnostics).toEqual([
      {
        version: 1,
        type: "diagnostic",
        level: "info",
        message: "fake Claude started",
      },
      {
        version: 1,
        type: "diagnostic",
        level: "error",
        message: "Claude fixture warning",
      },
      {
        version: 1,
        type: "diagnostic",
        level: "info",
        message: "tool completed",
        context: { tool: "Read" },
      },
    ]);
  });

  it("uses a failed result record as the authoritative turn state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pau-claude-streaming-"));
    temporaryDirectories.push(cwd);
    const registry = new ClaudeProcessRegistry();
    registries.push(registry);
    const process = await registry.start({
      discovery: await discoverClaude({ executablePath: fakeClaude }),
      cwd,
      env: {
        ...globalThis.process.env,
        FAKE_CLAUDE_MODE: "stream",
        FAKE_CLAUDE_STREAM_FIXTURE: join(
          fixtures,
          "claude-failed-stream.jsonl",
        ),
      },
    });
    const events: EventFrame[] = [];

    const completion = await process.prompt("Fail this fixture", {
      onEvent: (event) => events.push(event),
    });

    expect(completion).toEqual({
      status: "failed",
      error: "fixture failure",
      sessionId: "session-failed",
    });
    expect(events.map((event) => event.event)).toEqual([
      "text.delta",
      "turn.completed",
    ]);
    expect(events.at(-1)?.payload).toEqual(completion);
  });

  it("rejects a second prompt while a turn is active", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pau-claude-streaming-"));
    temporaryDirectories.push(cwd);
    const registry = new ClaudeProcessRegistry();
    registries.push(registry);
    const process = await registry.start({
      discovery: await discoverClaude({ executablePath: fakeClaude }),
      cwd,
      env: { ...globalThis.process.env, FAKE_CLAUDE_MODE: "stream" },
    });

    const first = process.prompt("First task");
    await expect(process.prompt("Second task")).rejects.toMatchObject({
      code: "prompt_in_progress",
    });
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });
});
