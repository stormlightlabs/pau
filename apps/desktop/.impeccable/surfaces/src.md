---
version: 1
slug: 'src'
primary_target: 'src'
related_targets: []
---

# Desktop app shell (redesign)

Scope: every desktop surface (shell and session, files and diff review,
terminal, Settings, Pi resources, empty, startup and error states). Mode:
Operate. Audience: a developer running many Pi and Claude Code sessions at
once, keyboard first, long stretches at a desk. Owner verdict after two
re-rolls: keep Strip Bay's layout, raise the craft.

## Direction contract

THESIS: Every session is a strip in a bay, racked by what it needs from you.
Refuses the three-pane IDE (file tree left, tabbed editor, bottom panel) and
the chat app (bubbles, agent as a person).

OWN-WORLD: Eldritch committed at shell scale: the `#12151d` blue-slate
ground from dev/design, the bay one step lifted, green on what needs you
and on the one primary action dev/design allows a surface (such as Save or
Start a session), cyan focus, state colours on marks and state lines
only. One 8px construction grid sets every strip, column and gutter.
Overpass at a fixed scale with caps-centred controls; Overpass Mono,
ligatures off, for paths, numbers and durations. Fixed-height strips with
the same fields on one baseline, everywhere a list of live things appears.

STORY: The developer sees at a glance which sessions need them, steps through
them by keyboard, answers or steers, checks what changed, and moves on.

FIRST VIEWPORT: Left 344px strip bay (filter, New session, Needs you,
Running, Settled). Centre the active session: one-line header with state and
an isolated danger Stop, transcript in a 75ch column, tool calls as inline
strips, the permission request as the focal point, composer docked. Right
304px workspace: changes, branch, terminal peek.

FORM: Strip Bay, candidate 5 of my ordered list; seed: 12d99e079d3a9ff6.
Signature move: the bay racks strips by attention, and the accent lives only
in Needs you.

FINISH: unreviewed and undocumented is unfinished. This build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.
