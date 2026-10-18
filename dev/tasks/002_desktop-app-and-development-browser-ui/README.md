# 2. Desktop app and development browser UI

`apps/desktop` owns the local SvelteKit product and may run in a normal browser
during development. Tauri is the shipped application in this deliverable.
`apps/web` is reserved for the later standalone and remote server product.

Units live in one file per area. Unit numbers are unique across the
deliverable, and blocker lists may name units in any area file.

## Areas

- [Sandbox and permissions](sandbox-and-permissions.md): 14 units
- [Terminal and shell](terminal-and-shell.md): 13 units
- [Process recovery](process-recovery.md): 5 units
- [Editors](editors.md): 9 units
- [Workspaces and navigation](workspaces-and-navigation.md): 15 units
- [Sessions](sessions.md): 24 units
- [Review](review.md): 4 units
- [Polish and motion](polish-and-motion.md): 36 units
- [Agent adapters](agent-adapters.md): 8 units
- [Pi resources](pi-resources.md): 13 units
- [Release](release.md): 9 units

## Dogfood gate

### 2.40 Pi TUI parity and primary dogfood gate

Status: planned
Blocked by: 2.116, 2.156, 2.185, 2.235, 2.239, 2.240, 2.242, 2.246, 2.247, 2.248, 2.249, 2.250, 2.251, 2.252, 2.254, 2.255, 2.256, 2.258, 2.260, 2.262, 2.263, 2.268

Confirm that the desktop app covers vanilla Pi's interactive workflows, then do
normal project work through Pau. Use vanilla Pi in the persistent terminal only
for terminal-specific extension components.

Verification:

- Audit the current Pi TUI actions and RPC commands against the implemented Pau
  controls, recording unsupported native capabilities with an explanation.
- Complete normal project work through Pau using configured skills, prompts,
  extensions, MCP tools when installed, queued messages, compaction, session
  branching, review, CodeMirror, and the persistent terminal in the installed
  macOS build.

**Primary dogfood replacement point:** When 2.40 is complete, Pau replaces
vanilla Pi with `pi-mcp-adapter` in a terminal for routine Pi work, including
MCP. Vanilla Pi remains available in Pau's persistent terminal for terminal-only
extension components. Pau is also the primary dogfood interface for routine
Claude work. Deep editor embedding and Linux release packaging remain later
milestones.

## Deliverable exit

The desktop-owned Tauri app can run concurrent Pi, Claude, Codex, and
Antigravity work at each adapter's supported capability level. It covers vanilla
Pi's structured interactive workflows, configures and uses agent MCP servers,
inspects and edits a workspace in CodeMirror, provides optional language
services, uses a persistent terminal, and hands work to a preferred external
editor. It reports local resource use, records redacted mutation audit events,
recovers supported native work after frontend or application failure, and can
launch supported work inside an explicit local sandbox. The desktop frontend
also works in its browser development mode, all five themes cover the shipped
surfaces, and the website and AppImage are publishable.
