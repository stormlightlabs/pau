#!/usr/bin/env node

import { createInterface } from "node:readline";

const VERSION = 1;
let sequence = 0;

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

writeDiagnostic("info", "fake Claude started");

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
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
