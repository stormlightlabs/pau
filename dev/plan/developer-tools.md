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
compressing it beside the workspace and review rails. Vim, Neovim, Helix, and
other terminal editors run as ordinary persistent PTY sessions with their native
configuration and behavior.

## Editors

CodeMirror is Pau's primary built-in editor. It handles file reading, quick
edits, read-only previews, agent-change review, diffs, diagnostics, dirty state,
external-change detection, and explicit save or revert. Keep it focused on work
that benefits from staying beside sessions and review context. Do not reproduce
a full development environment in the browser. Optional language services reuse
a backend language-server supervisor instead of running servers in the browser.

The built-in editor opens UTF-8 text files up to 2 MiB. Binary, oversized, and
invalid-encoding files show a named state instead of a text buffer. Files whose
permissions are read-only open without editing, and the save control is
disabled. Saves include the revision returned by the last read and fail on a
mismatch. While a file is open, the client checks its revision every two seconds
and preserves unsaved text when it reports an external change. The operator
then chooses whether to reload the disk version or keep the local version before
saving.

The operator can configure a preferred external editor. Known launch adapters
open a workspace, file, line and column, or diff in Neovim, Vim, Helix, Visual
Studio Code, and Zed. A command template covers other editors. Adapters expose
only supported launch capabilities and do not pretend to share buffers, cursor
state, tabs, extensions, or language-server state.

Workspace files remain authoritative. Pau watches for changes made by an
external or terminal editor and applies the same dirty-file and conflict rules
used for any external modification. Launch commands show their executable and
arguments before the operator saves a custom template. An editor launched by
Pau reports startup failure and process exit when the platform provides a useful
process handle; Pau does not claim ownership of a detached editor process.

Deep browser embedding for Neovim or another editor is deferred beyond the first
release. It may later add editor-specific capabilities without expanding the
common launch contract.
