# Terminal and editors

## Terminal

The terminal is a first-class workspace surface, not a shell-command text box.
Rust owns each PTY and its child process through `portable-pty`, subject to the
dependency spike. The browser uses `@xterm/xterm` and its official addons from
`packages/ui`; it never talks directly to a local process. We will configure
and compose these libraries rather than write a terminal emulator.

A terminal session has a stable ID, workspace, shell command, dimensions, title,
status, and attachment count. Opening a terminal uses the user's interactive
shell in the workspace directory. The environment can inherit the backend
process, use a login shell, or run through an explicitly enabled workspace
environment such as `direnv exec`. The app must not source an `.envrc` itself
or bypass direnv's trust decision.

WebSocket binary frames carry input and output; typed control messages handle
create, attach, resize, signal, detach, and close. Output tasks must apply
bounded backpressure so a noisy command cannot exhaust server memory. The
backend retains bounded scrollback for reattachment and marks a replay as
partial if older bytes were discarded. PTYs survive route changes, frontend
reloads, and browser disconnects. They stop when the user closes them, their
process exits, or Pau explicitly quits; closing and reopening a view does not
stop them.

The UI supports multiple named terminal tabs, accurate resize, copy and paste,
selection, search, links, bell and activity state, exit status, and
keyboard-only operation. It uses xterm.js's canvas renderer first and treats
WebGL as an optional measured optimization. OSC links and file paths are parsed
conservatively and never execute commands on click.

In the workspace layout, terminals can occupy the main surface or a resizable
bottom dock. A narrow viewport uses a full-surface terminal rather than
compressing it beside the workspace and review rails. Neovim may run in a
terminal as an escape hatch, but the embedded Neovim UI remains a separate
primary editor path.

## Neovim and editor

The Neovim path is a real external UI:

1. Rust starts `nvim --embed` in the workspace.
2. A maintained RPC library speaks msgpack-RPC and calls `nvim_ui_attach` with
   line-grid capabilities.
3. Redraw batches are translated to compact WebSocket events.
4. An existing embeddable web renderer handles grids and input when the
   dependency spike finds a suitable one; otherwise the browser supplies a thin
   canvas or DOM grid layer.
5. Clipboard and file-open requests cross explicit backend APIs.

Implement or adopt the base line grid before enabling multigrid, floating
windows, or GUI font shaping. Keep the renderer behind a frontend interface so a
library or rendering strategy can change without changing the Rust protocol.

A Neovim session starts clean by default. The user can instead load their
`init.lua`; applying Pau's theme is an independent option. A maintained
Kickstart configuration preset is a backlog item, not a first-release
requirement.

CodeMirror handles quick edits, read-only previews, and diffs. Neovim is the
primary full editor. LSP support for CodeMirror is optional and should reuse a
backend language-server supervisor rather than run servers in the browser.
