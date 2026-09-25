# Hardening

A design that works only with perfect data and a fast network is incomplete.
Cover states that the product can actually encounter.

## Content extremes

Test:

- empty and single-item collections;
- long names, paths, titles, descriptions, and unbroken strings;
- large counts and numeric alignment;
- emoji, accented text, CJK, and RTL;
- 30–40% text expansion;
- enough rows to require pagination, search, or virtualization.

Use `min-width: 0` for shrinking flex/grid children, deliberate wrapping for
prose, truncation only when the full value remains available, and logical CSS
properties for direction changes.

## Async and failure states

Cover initial loading, incremental loading, refresh, timeout, offline, rejected
permission, validation failure, conflict, rate limit, server error, partial
success, and reconnect where relevant.

- Say what is happening rather than showing an unexplained spinner.
- Keep the old content visible during refresh when it is still useful.
- Preserve user input and selections after recoverable failures.
- Explain whether work is safe and offer the next valid action.
- Isolate component failures when the rest of the surface can continue.
- Prevent double submission and stale-response races.

## Empty and permission states

An empty state should name why the area is empty and teach the next action. A
permission state should distinguish unavailable capability from missing data and
state how access can change, if the user can change it.

## Localization and formatting

Use locale-aware date, time, number, currency, plural, and relative-time
formatting. Do not concatenate sentences from translated fragments. Avoid fixed
text widths and directional icons that fail in RTL.

## Accessibility resilience

Verify semantics, names, focus order, announcements, high contrast, color
independence, keyboard operation, and 200% zoom in loading and failure states as
well as the happy path. Ensure an update does not steal focus or repeatedly
announce noisy progress.

## Performance resilience

Keep noisy streams and large lists bounded. Clean up observers, subscriptions,
timers, and event listeners. Abort obsolete requests. Use skeletons only when
they match the eventual structure; do not animate a large field of placeholders
indefinitely.

## Verify

Exercise the most likely and highest-risk edge cases, not an imaginary matrix of
every HTTP code. Add tests where a state transition or failure mode can regress.
Record anything that requires a real device, service, or permission and was not
tested.
