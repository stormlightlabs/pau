#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fakeClaude = join(packageRoot, "test/fixtures/fake-claude.mjs");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pau-claude-package-"));

try {
  const packDirectory = join(temporaryRoot, "pack");
  await mkdir(packDirectory);
  const pack = run("npm", [
    "pack",
    packageRoot,
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    packDirectory,
  ]);
  const [{ filename }] = JSON.parse(pack.stdout);
  const tarball = join(packDirectory, filename);
  const installRoot = join(temporaryRoot, "installed");
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    installRoot,
    tarball,
  ]);

  const installedPackage = join(
    installRoot,
    "node_modules/@stormlightlabs/pau-claude-bridge",
  );
  const manifest = JSON.parse(
    await readFile(join(installedPackage, "package.json"), "utf8"),
  );
  if (!manifest.pi?.extensions?.includes("./dist/pi-extension.js")) {
    throw new Error("Packed artifact does not declare its compiled Pi extension");
  }

  const agentDirectory = join(temporaryRoot, "agent");
  const workspace = join(temporaryRoot, "workspace");
  await mkdir(workspace);
  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDirectory,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PAU_CLAUDE_PATH: fakeClaude,
  };
  run("pi", ["install", installedPackage], { env: environment });
  await exerciseInstalledPackage(workspace, environment);
  process.stdout.write("Packed artifact loaded and discovered fake Claude.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}`,
    );
  }
  return result;
}

function exerciseInstalledPackage(cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let commandsLoaded = false;
    let fakeDiscovered = false;
    const timer = setTimeout(() => finish(
      new Error(`Packed artifact test timed out:\n${stderr}`),
    ), 15_000);

    const finish = (error) => {
      clearTimeout(timer);
      child.stdin.end();
      if (error) reject(error);
      else resolve();
    };

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.id === "commands") {
          const names = record.data?.commands?.map((command) => command.name) ?? [];
          if (!names.includes("claude-discover")) {
            finish(new Error("Packed artifact did not register /claude-discover"));
            return;
          }
          commandsLoaded = true;
          child.stdin.write(
            `${JSON.stringify({
              id: "discover",
              type: "prompt",
              message: "/claude-discover",
            })}\n`,
          );
        }
        if (
          record.type === "extension_ui_request" &&
          record.method === "notify" &&
          record.message?.includes("Claude Code 2.1.281")
        ) {
          fakeDiscovered = true;
        }
        if (record.id === "discover" && record.success === false) {
          finish(new Error(`Fake-agent command failed: ${record.error}`));
          return;
        }
        if (commandsLoaded && fakeDiscovered) {
          finish();
          return;
        }
      }
    });
    child.once("error", finish);
    child.stdin.write('{"id":"commands","type":"get_commands"}\n');
  });
}
