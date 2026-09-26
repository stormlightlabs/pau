# Dogfooding

Use Pau to build Pau as each surface becomes usable. The Claude bridge is the
first dogfood surface: after its packaged live smoke test passes, use it for
suitable Pau tasks while the desktop application is still being built. Then
adopt Pau's agent sessions, workspace UI, terminal, editor, review tools, and
standalone server in normal project work. The unit that first makes a surface
usable includes a self-hosted smoke run when practical; later work should use
that surface by default when it fits the task.

Dogfooding supplements deterministic tests and does not replace them. Fix a
discovered defect in the active unit when it violates that unit's behavior or
verification. Otherwise track it separately so self-hosting does not expand
unrelated work.
