#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const VERSION = 1;
const mode = process.env.FAKE_CLAUDE_MODE ?? "protocol";
let sequence = 0;
let keepAlive;

if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.3 (Claude Code)"}\n`);
  process.exit(0);
}

function writeProtocol(frame, split = false, afterWrite) {
  const line = `${JSON.stringify(frame)}\n`;
  if (!split) {
    process.stdout.write(line);
    afterWrite?.();
    return;
  }

  const midpoint = Math.floor(line.length / 2);
  process.stdout.write(line.slice(0, midpoint));
  setImmediate(() => {
    process.stdout.write(line.slice(midpoint));
    afterWrite?.();
  });
}

function writeDiagnostic(level, message) {
  process.stderr.write(
    `${JSON.stringify({ version: VERSION, type: "diagnostic", level, message })}\n`,
  );
}

function recordSignal(signal) {
  if (process.env.FAKE_CLAUDE_SIGNAL_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_SIGNAL_LOG, `${signal}\n`);
  }
}

writeDiagnostic("info", "fake Claude started");
if (process.env.FAKE_CLAUDE_CWD_FILE) {
  writeFileSync(process.env.FAKE_CLAUDE_CWD_FILE, process.cwd());
}

if (mode === "unexpected-exit") {
  setTimeout(() => process.exit(23), 20);
}
if (mode === "interrupt-exit") {
  process.on("SIGINT", () => {
    recordSignal("SIGINT");
    process.exit(0);
  });
}
if (mode === "ignore-shutdown") {
  process.on("SIGINT", () => recordSignal("SIGINT"));
  process.on("SIGTERM", () => recordSignal("SIGTERM"));
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("close", () => {
  if (mode === "interrupt-exit" || mode === "ignore-shutdown") {
    keepAlive = setInterval(() => {}, 1_000);
  }
});

lines.on("line", (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    writeDiagnostic("error", "received malformed command");
    return;
  }

  if (mode === "stream") {
    if (
      command.type !== "user" ||
      command.message?.role !== "user" ||
      typeof command.message?.content !== "string"
    ) {
      process.stderr.write("received invalid stream-json prompt\n");
      return;
    }

    if (process.env.FAKE_CLAUDE_STREAM_FIXTURE) {
      const output = readFileSync(process.env.FAKE_CLAUDE_STREAM_FIXTURE, "utf8");
      const midpoint = Math.floor(output.length / 2);
      if (process.env.FAKE_CLAUDE_DIAGNOSTIC_FIXTURE) {
        process.stderr.write(
          readFileSync(process.env.FAKE_CLAUDE_DIAGNOSTIC_FIXTURE, "utf8"),
        );
      }
      process.stdout.write(output.slice(0, midpoint));
      setImmediate(() => process.stdout.write(output.slice(midpoint)));
      return;
    }

    process.stderr.write("Claude fixture warning\n");
    writeProtocol(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "fixture output" },
        },
      },
      true,
      () => {
        writeProtocol({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 1,
            content_block: {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { path: "README.md" },
            },
          },
        });
        writeProtocol({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "file contents",
                is_error: false,
              },
            ],
          },
        });
        writeProtocol({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Done",
          session_id: "session-fixture",
        });
      },
    );
    return;
  }

  if (
    command.version !== VERSION ||
    command.type !== "command" ||
    typeof command.id !== "string"
  ) {
    writeDiagnostic("error", "received invalid command");
    return;
  }

  writeProtocol(
    {
      version: VERSION,
      type: "event",
      sequence: sequence++,
      event: "text.delta",
      payload: { text: "fixture output" },
    },
    true,
    () =>
      writeProtocol({
        version: VERSION,
        type: "response",
        id: command.id,
        ok: true,
        result: { accepted: true },
      }),
  );
});
