# 2. Desktop app: Terminal and shell

## Terminal and shell

### 2.57 Terminal detach and replay

Status: planned
Blocked by: none

Add attach, detach, bounded scrollback, and replay on attach to `pau-term`.

Verification:

- Cover detach and replay and discarded scrollback.
- Run focused tests on Linux and macOS.

### 2.58 Terminal reattach

Status: planned
Blocked by: 2.57

Reattach terminal tabs with their replayed scrollback after a route change.

Verification:

- Confirm terminal tabs reattach with their scrollback after a route change.

### 2.95 Terminal output backpressure

Status: planned
Blocked by: 2.57

Apply backpressure when a terminal client reads output more slowly than the
PTY produces it.

Verification:

- Cover a slow consumer during noisy output without unbounded memory growth.

### 2.96 Terminal layouts

Status: planned
Blocked by: none

Add main-surface and bottom-dock terminal layouts.

Verification:

- Cover both layouts at desktop and narrow widths.

### 2.98 Terminal links

Status: planned
Blocked by: none

Detect conservative links in terminal output and open them on request.

Verification:

- Cover URLs, workspace file paths, and text that must not become a link.

### 2.99 Terminal activity

Status: planned
Blocked by: none

Mark terminal tabs that have new output while they are in the background.

Verification:

- Component-test idle, active, and exited tabs.

### 2.100 Full-screen terminal programs

Status: planned
Blocked by: none

Support alternate-screen output and mouse input in the terminal view.

Verification:

- Run alternate-screen and mouse scenarios in Playwright, including
  representative Vim, Neovim, and Helix sessions.

### 2.56 Sandboxed terminal relay

Status: planned
Blocked by: none

Add the sandboxed terminal profile. Start a `pau-term` relay inside the sandbox
that opens its own PTY, runs the shell on it, forwards bytes to the operator's
PTY, and applies resizes from a control channel. Terminal editors use the same
profile.

Verification:

- Confirm the inner PTY works under Bubblewrap's private `/dev` and Seatbelt.
- Cover Ctrl-C, Ctrl-Z, `fg`, `bg`, resize redraw in Neovim, shell exit, relay
  crash, and cleanup of the shell's descendants.
- Confirm keystroke injection from the sandboxed shell reaches only the inner
  PTY.
- Confirm sandboxed terminal profiles inherit their recorded filesystem,
  network, environment, and process limits.
- Measure the memory of each terminal's `srt` process.

### 2.101 Sandboxed terminal selection

Status: planned
Blocked by: 2.56

Let the operator open a terminal with a sandbox profile and show which profile
each terminal uses.

Verification:

- Component-test sandboxed, unsandboxed, and unavailable profiles.
- Confirm the profile stays unavailable when the relay cannot start.

### 2.26 Login shell environment

Status: planned
Blocked by: none

Add a login-shell launch profile beside the inherited environment.

Verification:

- Cover inherited and login-shell launches and paths containing spaces.

### 2.102 Direnv shell environment

Status: planned
Blocked by: 2.26

Add a launch profile for explicitly trusted `direnv exec`. Never source `.envrc`
directly.

Verification:

- Cover workspaces with no `.envrc`, allowed and blocked `.envrc` files, and
  failed direnv evaluation.

### 2.103 Shell environment selector

Status: planned
Blocked by: 2.102

Let the operator choose a workspace's shell environment and report the active
mode in each terminal.

Verification:

- Component-test each environment mode and a failed direnv evaluation.
