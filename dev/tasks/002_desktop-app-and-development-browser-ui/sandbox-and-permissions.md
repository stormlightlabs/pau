# 2. Desktop app: Sandbox and permissions

## Process containment

### 2.144 Linux denial preload verification

Status: planned
Blocked by: none

Verify the denial preload library on a Linux host and record its overhead.

Verification:

- Cover denied reads, writes, creates, renames, Unix sockets, and direct TCP
  from dynamically linked programs and their descendants.
- Confirm statically linked programs still fail closed and fall back to policy
  comparison or the sandboxed-failure label.
- Measure the library's overhead on a representative build and test command.

### 2.158 Sandboxed live Pi sessions

Status: planned
Blocked by: none

Start live Pi sessions inside the workspace's selected sandbox instead of
refusing them.

Verification:

- Start a sandboxed session through the desktop API against the fake Pi
  executable and confirm its tools run inside the sandbox.
- Confirm a sandbox that cannot start fails the session start with its reason.

## Permissions

### 2.92 Native permission callback spike

Status: planned
Blocked by: none

Validate the same permission profiles against Claude's native permission
callbacks.

Verification:

- Prove allow and deny happen before a fixture tool, shell command, file write,
  and MCP call executes in Claude.
- Confirm unsupported adapters cannot present cosmetic permission controls.
- Record the callback surface and known gaps in `dev/plan/backend.md`.

### 2.54 Mutation audit log

Status: planned
Blocked by: none

Record bounded, redacted audit events for desktop process, file, and sandbox
mutations. Later mutating features add their own events to this log. Keep audit
records separate from diagnostic logs and never retain command secrets, file
contents, tool arguments, credentials, or environment values.

Verification:

- Cover successful, denied, failed, cancelled, and concurrent mutations with
  workspace, session, actor, operation, and result correlation.
- Confirm seeded sensitive values are absent from storage, API responses, UI
  events, and exports.
- Confirm observation does not change authorization, execution order, retries,
  or process ownership.

### 2.163 Subagent permission setting

Status: planned
Blocked by: none

Let the operator choose whether a session that loads `pi-subagents` refuses a
confirming profile or passes the permission extension and policy to child Pi
processes.

Verification:

- Cover the refusal, its explanation, and a child process that receives the
  extension and policy file.

### 2.45 Pi permission requests

Status: planned
Blocked by: 2.54

Implement the selected permission profiles for Pi through Pau's permission
extension.
Queue requests per session, apply allow-once and deny decisions, and write
redacted audit records. Keep permission rules separate from sandbox profiles.

Verification:

- Cover deny, allow once, and concurrent per-session queues against the Pi
  fixture.
- Confirm an approval cannot exceed sandbox access and direct terminal input
  does not create agent permission prompts.

### 2.62 Permission prompts

Status: planned
Blocked by: 2.45

Show each request's session, operation, affected paths or destination, selected
sandbox, and approval lifetime. Adapters without permission support show no
permission controls.

Verification:

- Component-test pending, allowed, denied, and unsupported-adapter states.
- Approve and deny requests in a self-hosted Pi task.

### 2.93 Permission profile setting

Status: planned
Blocked by: 2.62

Let the operator choose a permission profile. Changing it restarts Pi on the
same session file.

Verification:

- Component-test each shipped profile and the permissions-off state.
- Complete a self-hosted Pi task with permissions off and with each shipped
  permission profile enabled.

### 2.63 Session approvals

Status: planned
Blocked by: 2.45

Add allow-for-session approvals.

Verification:

- Cover allow for session, session end, and session replacement against the Pi
  fixture.

### 2.64 Session approval view

Status: planned
Blocked by: 2.62, 2.63

Offer allow for session in permission prompts and list the active session
approvals.

Verification:

- Component-test the allow-for-session choice and the approval list.

### 2.82 Permission request recovery

Status: planned
Blocked by: 2.63

Handle reconnects, timeouts, cancellation, stale responses, and adapter failure
for pending permission requests.

Verification:

- Cover bounded reconnect, timeout, cancellation, stale responses, and adapter
  failure against the Pi fixture.

### 2.83 Permission request recovery states

Status: planned
Blocked by: 2.64, 2.82

Show timed-out, cancelled, and stale requests. Restore pending prompts after a
reconnect.

Verification:

- Component-test timed-out, cancelled, and stale requests.
- Reload the frontend with a pending request and confirm the prompt returns.

### 2.65 Claude permission requests

Status: planned
Blocked by: 2.82, 2.92

Route Claude's native permission callbacks into the permission request queue.

Verification:

- Cover deny, allow once, allow for session, and adapter failure for Claude.
- Complete a self-hosted Claude task through the permission prompts with
  permissions off and with each shipped permission profile enabled.

### 2.94 MCP permission requests

Status: planned
Blocked by: 2.65

Route MCP tool calls from Pi and Claude through the permission request queue.

Verification:

- Complete self-hosted MCP fixture flows from Pi and Claude with permissions off
  and with each shipped permission profile enabled.
