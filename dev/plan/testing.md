# Testing

Choose the smallest test that proves the behavior. Keep edge-heavy logic out of
UI components, exercise process boundaries with fake executables, and reserve
full browser tests for workflows that cross packages or transports.

## Rust tests

Rust unit tests live beside framing, path authorization, state transitions,
reducers, migrations, event replay, redaction, and capability mapping. Use
table-driven cases for known failures and property tests where arbitrary input
matters, especially protocol framing, event sequences, and path handling. Use
Tokio's paused clock for timeout, retry, and shutdown behavior instead of
sleeping in tests.

Integration tests launch fake Pi, Claude, terminal, and Neovim processes. They
cover partial and oversized frames, invalid UTF-8 where the protocol permits
bytes, early exits, ignored signals, cancellation races, output backpressure,
replay gaps, symlink and traversal attempts, SQLite rollback and migration
failure, and cleanup after dropped clients. Platform-specific PTY and filesystem
tests run on Linux and macOS. Fuzz targets are appropriate for parsers exposed
to agent or network input, but they remain a separate scheduled or manual job
rather than slowing every pull request.

## Storybook and component tests

`packages/ui` owns Storybook as the visual workbench for product components and
feature views. Stories use typed fixtures and cover useful states such as empty,
loading, running, waiting, failed, disconnected, long content, narrow width, and
each shipped theme. Storybook controls switch theme, viewport, reduced motion,
and representative capability sets so design feedback does not require a live
agent or Tauri.

Use Storybook `play` functions for short interactions that make a story
demonstrably usable. Run them through Storybook's Vitest integration and include
accessibility checks. Keep dedicated Vitest tests for deeper state transitions
and edge cases instead of turning every story into a large test.

Use Vitest for plain TypeScript reducers, stores, validation, theme contracts,
and content tooling. Use Playwright-backed Vitest browser mode with
`vitest-browser-svelte` for Svelte components whose focus, events, layout, or
lifecycle require a real browser. Query components by role, label, and visible
text rather than Svelte internals. Add SSR and server tests for SvelteKit
routes, endpoint helpers, metadata, and hydration-sensitive output.

Build Storybook in CI. Keep a small set of reviewed Playwright screenshots for
stable, high-value compositions such as the application shell, session states,
editor/review layout, terminal dock, resource browser, and all-theme coverage.
Do not snapshot every component or use screenshots as a substitute for behavior
assertions.

## Application integration tests

`apps/web` owns Playwright workflows against the real Axum API with fake agent
executables. These tests cover route composition, authentication, reconnect,
concurrent sessions, files, terminal, Neovim, and resources from the user's
point of view. The same web build is consumed by Tauri, so `apps/desktop` adds
only native smoke coverage for startup, backend lifecycle, asset loading, and
shutdown rather than duplicating browser behavior.

`apps/website` tests frontmatter, internal links, raw Markdown routes, search,
metadata, and responsive reading layouts. Playwright covers navigation, search,
copy controls, theme behavior, and selected visual states.

Generated TypeScript contracts and shared protocol fixtures run against both
Rust and TypeScript consumers. Chromium is the fast default for browser
component tests. Critical Playwright flows also run in WebKit because Tauri uses
a system webview on Linux and macOS; standalone-server smoke coverage can add
Firefox without multiplying every component test.

Keep local feedback layered: focused unit and component tests during
development, the complete fake-backed suite plus Storybook build on pull
requests, and cross-platform PTY tests, fuzzing, and broader browser matrices on
scheduled or release jobs. Collect coverage to find untested branches, but do
not substitute a repository-wide percentage target for named edge cases and
behavior assertions.

Default checks use fake processes and local fixtures. Tests that invoke paid
agents, require signing credentials, or depend on remote services are opt-in and
never part of the default command.
