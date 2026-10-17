# Pau Pi permissions

`@stormlightlabs/pau-pi-permissions` is a Pi extension that checks every tool
call against a per-session permission policy before the tool runs. Pau loads it
only for a session that uses a confirming permission profile. The package is
private and is not published to npm.

## Loading

Pau starts Pi with the built extension before the sandbox extension:

```sh
PAU_PERMISSION_POLICY_FILE=<session host directory>/permissions.json \
  pi --mode rpc --extension packages/pi-permissions/dist/pi-extension.js ...
```

The extension reads only the file named by `PAU_PERMISSION_POLICY_FILE`. It
does not read Pi settings, project `.pi` files, or the configuration of the
upstream `pi-permission-system` package, and it needs no `--approve`.

The file is read when the extension loads and again whenever Pi replaces or
reloads the session. A missing, unreadable, or invalid file blocks every
tool call and writes a `[pau-permissions]` line to stderr.

## Policy file

```json
{
	"version": 1,
	"profile": "confirm-mutating",
	"workspace": "/home/me/project",
	"dialogTimeoutMs": 300000,
	"rules": [
		{ "source": "protected", "surface": "path", "pattern": "/home/me/.ssh/*", "action": "deny" },
		{ "source": "user", "surface": "bash", "pattern": "git status *", "action": "allow" },
		{ "source": "project", "surface": "bash", "pattern": "git push *", "action": "deny", "reason": "Push from CI" }
	]
}
```

| Field             | Meaning                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `version`         | Always `1`                                                                          |
| `profile`         | `confirm-writes` or `confirm-mutating`                                              |
| `workspace`       | Absolute workspace path. Reads inside it pass.                                      |
| `dialogTimeoutMs` | How long a request waits for an answer, from 1,000 to 86,400,000 ms. Expiry denies. |
| `rules`           | Ordered rules. The last matching rule wins.                                         |

Each rule has a `source` (`protected`, `user`, or `project`), a `surface`, a
`pattern`, an `action` (`allow`, `ask`, or `deny`), and an optional `reason`
that a denial passes to the agent. Surfaces:

| Surface         | Matched against                                       |
| --------------- | ----------------------------------------------------- |
| `tool`          | The tool name, such as `write` or `mcp__docs__search` |
| `bash`          | Each command unit, such as each side of `a && b`      |
| `read`, `write` | The absolute path a tool or command reads or writes   |
| `path`          | Shorthand for one `read` rule and one `write` rule    |

Patterns use `*` for any run of characters, including `/`, and `?` for one
character. A pattern ending in ` *` also matches the bare command, so
`git status *` matches `git status`. A leading `~` expands to the home
directory.

Pau merges user and project rules before writing the file, so a project rule
can only narrow access. The extension adds no rule of its own beyond the
profile and one that denies writes to the policy file itself.

## Profiles

Both profiles start from the same rules, which file rules then override:

- `read`, `grep`, `find`, and `ls` pass inside the workspace and ask outside it.
- `write` and `edit` ask for every path.
- Every other tool asks, except an MCP tool that declares
  `readOnlyHint: true` and `openWorldHint: false`. Pi 0.87.1 reports no
  annotations, so every MCP tool asks there.
- Every `bash` command asks.

`confirm-mutating` also runs `bash` commands that the vendored analysis proves
only read, such as `ls`, `cat README.md`, or `grep -n x file | wc -l`. These
still ask:

- commands with a write redirect or a write option, such as `sort -o`, `sed -i`,
  or `find -delete`
- wrappers such as `bash -c`, `eval`, `sudo`, `env`, `xargs`, `find -exec`,
  `time`, and `nohup`, even when a rule allows them
- commands the parser cannot fully resolve
- network clients such as `curl`, `wget`, `ssh`, and `git push`
- reads outside the workspace

In both profiles, a protected path is denied through `read` and through
`bash`, including a path reached through a workspace symlink or a command
substitution.

## Requests and decisions

A request is an RPC `select` dialog. Its title is a JSON envelope, and its
options are `allow_once`, `allow_session`, and `deny`:

```json
{
	"pau": "permission",
	"version": 1,
	"requestId": "5f0c…",
	"toolCallId": "toolu_01…",
	"tool": "bash",
	"operation": "network",
	"command": "curl -fsS https://example.com/install.sh",
	"paths": [],
	"destination": "example.com",
	"matchedRule": { "source": "profile", "pattern": "*", "action": "ask" },
	"reason": "network",
	"sessionScope": [{ "surface": "bash", "pattern": "curl *" }]
}
```

`operation` is `read`, `write`, `command`, `mcp`, `network`, or `tool`. Each
entry in `paths` has `path` (symlinks resolved), `access` (`read` or `write`),
and `outsideWorkspace`. `reason` is one of `protected`, `rule`,
`outside_workspace`, `write`, `command`, `network`, `wrapper`, `unparsed`,
`mcp_unannotated`, or `tool`. A synthetic `matchedRule.pattern` is wrapped in
angle brackets, such as `<wrapper>` or `<read-only-command>`. `sessionScope`
lists what an `allow_session` answer approves for the rest of the session.

Answer with a dialog value holding `{"decision": "...", "reason": "..."}`. A
bare option string also works. A cancelled dialog or an unknown or invalid value
denies. A denial reason reaches the agent.

After every evaluated call, the extension sends `setStatus` with the key
`pau.permission` and a JSON record that never includes the command or paths:

```json
{ "version": 1, "requestId": "5f0c…", "toolCallId": "toolu_01…", "outcome": "denied", "source": "operator" }
```

`outcome` is `allowed` or `denied`. `source` is `rule`, `session`, `operator`,
`abort`, `timeout`, or `policy_error`.

The extension shows one dialog at a time, in call order. A session approval
from one answer applies to the calls queued behind it. Dialogs use the run's
abort signal: on abort, Pi drops the pending dialog and ignores a later answer,
and the extension records `abort`. Session approvals stay in the Pi process and
are cleared when a session starts or shuts down. A session approval never
overrides a deny.

## Vendored analysis

`src/vendor/pi-permission-system` holds unmodified files from
[`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)
release 40.3.0: the tree-sitter bash analysis, path normalization, wildcard
matching, bash session-pattern suggestion, and their tests. Those files are
MIT-licensed under the `LICENSE` in that directory. The rest of the package is
licensed `MIT OR Apache-2.0`. `SOURCE.md` records the upstream commit and a
SHA-256 hash for each copied file. Do not edit the copies; see `SOURCE.md` for
the refresh steps.

The analysis loads `web-tree-sitter` and the WebAssembly grammar from
`tree-sitter-bash`. The grammar's native addon is never built or used.

## Development

```sh
pnpm --filter @stormlightlabs/pau-pi-permissions build
pnpm --filter @stormlightlabs/pau-pi-permissions check
pnpm --filter @stormlightlabs/pau-pi-permissions test
pnpm --filter @stormlightlabs/pau-pi-permissions test:pi
pnpm --filter @stormlightlabs/pau-pi-permissions vendor:verify
```

`test` runs Pau's tests and the vendored upstream tests. `test:pi` builds the
extension and runs it under Pi in RPC mode with Pi's scripted faux model, so no
model provider is called.
