# 2. Desktop app: Review

## Review

### 2.211 Diff comments to the composer

Status: planned
Blocked by: none

Let the operator comment on diff lines and add those comments to the current
session's composer draft as quoted blocks with path and line.

Verification:

- Component-test adding, editing, and removing comments, and inserting several
  into a draft.

### 2.212 Hunk stage and revert

Status: planned
Blocked by: 2.54

Stage, unstage, and revert a hunk or file through Git and record each change in
the mutation audit.

Verification:

- Cover each operation, a conflicting hunk, a binary file, and a file that
  changed after the diff was read.

### 2.213 Hunk stage and revert view

Status: planned
Blocked by: 2.212

Add stage, unstage, and revert controls to diff review, with confirmation for
revert.

Verification:

- Component-test each control, revert cancellation, and a stale-diff failure.

### 2.214 Diff update highlight

Status: planned
Blocked by: none

Tint diff hunks that change while a session runs, fading the tint over one
second.

Verification:

- Component-test a live hunk update, an unchanged hunk, and the static marker
  under reduced motion.
