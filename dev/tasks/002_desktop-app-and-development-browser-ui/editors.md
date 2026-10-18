# 2. Desktop app: Editors

## Editors

### 2.28 Language-server supervisor

Status: planned
Blocked by: none

Add an optional backend language-server supervisor. Reuse desktop workspace
process and environment handling.

Verification:

- Start one fixture language server, restart it after failure, and stop it when
  the workspace closes.
- Confirm external-editor language-server processes remain independent.
- Confirm the remote web app does not claim a desktop language service unless
  its server advertises the capability.

### 2.108 CodeMirror diagnostics

Status: planned
Blocked by: 2.28

Show language-server diagnostics in CodeMirror.

Verification:

- Publish diagnostics from the fixture server and confirm CodeMirror shows and
  clears them.

### 2.109 CodeMirror completion

Status: planned
Blocked by: 2.28

Request completions from the language server in CodeMirror.

Verification:

- Request completion from the fixture server and cover empty and failed
  responses.

### 2.51 Known editor launch

Status: planned
Blocked by: 2.54

Expose workspace, file, line and column, and diff launch capabilities through
known adapters for Neovim, Vim, Helix, Visual Studio Code, and Zed. Report
startup failure or useful process status without claiming ownership of a
detached editor. Record each launch in the mutation audit.

Verification:

- Exercise workspace, file, line, column, and diff launch for fixture commands
  that model every known adapter.
- Cover missing executables, paths with spaces and non-ASCII characters,
  detached GUI processes, and rapid repeated launch.
- Confirm a launch does not pass file content, credentials, or unrelated
  environment values.

### 2.66 Preferred editor setting

Status: planned
Blocked by: 2.51

Let the operator choose a preferred editor from the known adapters.

Verification:

- Component-test each known editor and a missing executable.

### 2.110 Open in editor

Status: planned
Blocked by: 2.66

Add open-in-editor actions for the workspace, the file tree, the CodeMirror
cursor position, and diffs. Show startup failures.

Verification:

- Modify an open file from an external editor fixture. Confirm CodeMirror
  reports the external change and preserves unsaved work.
- Complete one self-hosted handoff from CodeMirror to the configured editor and
  back through a detected file change.

### 2.111 Custom editor command

Status: planned
Blocked by: 2.51

Add an explicit command template for editors without a known adapter.

Verification:

- Exercise every launch capability through a custom template fixture.
- Cover invalid templates and paths with spaces and non-ASCII characters.

### 2.112 Custom editor setting

Status: planned
Blocked by: 2.66, 2.111

Let the operator enter a custom editor command.

Verification:

- Confirm the settings show a custom executable and arguments before saving
  them.

### 2.67 Terminal editor handoff

Status: planned
Blocked by: 2.51, 2.58

Launch terminal editors in a persistent Pau terminal tab and report editor exit.
Files stay authoritative.

Verification:

- Launch each known terminal editor fixture in a terminal tab and cover editor
  exit.
- Modify an open file from a terminal editor fixture. Confirm CodeMirror
  reports the external change and preserves unsaved work.
