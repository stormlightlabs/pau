#!/usr/bin/env node

import { appendFileSync, writeFileSync } from "node:fs";
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
