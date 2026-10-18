# 2. Desktop app: Process recovery

## Process recovery

### 2.29 Process survival

Status: planned
Blocked by: 2.57

Keep agent sessions and terminals alive across desktop frontend reloads, route
changes, and development-browser disconnects.

Verification:

- Disconnect every desktop API client while agent and terminal processes are
  active, then reconnect through the API.
- Confirm process survival does not weaken authentication, sandboxing,
  permissions, or resource limits.

### 2.59 Reconnect states

Status: planned
Blocked by: 2.29, 2.58

Restore agent sessions and terminal tabs in every desktop frontend after a
reload or disconnect. Show reconnecting, restored, and lost states.

Verification:

- Reload the desktop frontend and disconnect the development browser while
  agent and terminal processes are active. Confirm each surface restores its
  state.
- Component-test reconnecting, restored, and lost states.

### 2.107 Orderly shutdown

Status: planned
Blocked by: 2.29

Stop agent sessions and terminals in order when Tauri exits or receives a
termination signal.

Verification:

- Send termination signals during active work and confirm bounded cleanup.

### 2.60 Restart recovery

Status: planned
Blocked by: 2.29

Recover persisted process metadata after an unclean application restart. Report
which native sessions can resume instead of implying that every process can be
reattached.

Verification:

- Restart after a forced kill and report through the API which native sessions
  can resume.
- Confirm recovery does not weaken authentication, sandboxing, permissions, or
  resource limits.

### 2.61 Restart recovery view

Status: planned
Blocked by: 2.59, 2.60

After an unclean restart, show which sessions resumed, which can resume, and
which ended. Let the operator resume each session that supports it.

Verification:

- Component-test resumed, resumable, and ended sessions.
- Force-quit the desktop app during active work, restart it, and resume a
  supported session from the view.
