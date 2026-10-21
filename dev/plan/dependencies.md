# Dependency policy

Use maintained libraries for protocol, terminal, editor, and rendering work
before writing equivalents. Prefer small libraries with stable wire or platform
boundaries over adopting an IDE framework. Use Valibot for TypeScript runtime
schema validation unless an integration requires another validator. Record the
version, license, maintenance state, and the missing requirement that justifies
any custom implementation.

The initial choices to validate are:

- `@xterm/xterm` and official addons for terminal emulation, fitting, search,
  serialization, links, clipboard, Unicode, and optional WebGL rendering
- `portable-pty` for Rust PTY ownership on Linux and macOS
- CodeMirror 6 for lightweight editing and diff views
- editor command-line interfaces for external workspace, file, location, and
  diff launch
- Iconify through UnoCSS or unplugin for the selected icon sets

## Desktop dialog dependency selection

Use `tauri-plugin-dialog` 2.7.3 to show startup failures in a native message
dialog. The plugin is MIT or Apache-2.0 licensed and maintained in the Tauri
plugins workspace. Later 2.8 releases require Tauri 2.12. Only the Rust shell
calls it, so the webview gets no dialog permissions.

## Desktop opener dependency selection

Use `tauri-plugin-opener` 2.5.5 and the matching `@tauri-apps/plugin-opener`
package to show a workspace path in the system file manager and to open links
in the default browser or mail app. The plugin is MIT or Apache-2.0 licensed and
maintained in the Tauri plugins workspace. Releases from 2.6 require Tauri 2.12.

The main window may reveal paths and open `http`, `https`, and `mailto` URLs.
The capability scope allows only those three schemes, and the shared link
handler in `@stormlightlabs/pau-ui` refuses every other scheme before it asks
the shell. The window gets no permission to open a path with another
application, because the webview renders agent-generated content and an opened
file could be an executable. Pau turns off the plugin's own link-click script,
which would also open `tel:` links outside that handler.

## Desktop notification dependency selection

Use `tauri-plugin-notification` 2.4.0 and the matching
`@tauri-apps/plugin-notification` package to tell the operator when a session
out of view waits, asks a question, or fails. The plugin is MIT or Apache-2.0
licensed and maintained in the Tauri plugins workspace. Releases from 2.5
require Tauri 2.12. The Dock badge uses the window `setBadgeCount` API in Tauri
itself and adds no dependency.

The main window may check and request notification permission and send a
notification. It gets no permission to schedule, list, or cancel them. On
desktop the plugin reports no notification clicks, so a click focuses the app
through the operating system and does not open the session.

## Development settings

The browser development server loads the repository's `.env` with `dotenvy`
0.15.7, which is MIT-licensed and maintained. Node entry points use the
built-in `process.loadEnvFile`, and Vite uses its own `loadEnv`, so they add no
dependency.

## Pi permission extension dependencies

The vendored bash analysis in `packages/pi-permissions` uses `web-tree-sitter`
and the `tree-sitter-bash` grammar, both MIT-licensed. Pau ships only the
grammar's WebAssembly file and keeps `tree-sitter-bash` out of the packages
allowed to run install scripts.

## Resource monitoring dependency selection

Use `sysinfo` 0.38.4 for process discovery and CPU, accumulated CPU time,
resident memory, start time, parent PID, and disk counters. The crate is
MIT-licensed, actively maintained, and supports Linux and macOS through one API.
Pau keeps its own process identity, tree attribution, retention, warning, and
summary logic because those rules belong to Pau's process owners. Treat
per-process disk totals as unavailable on macOS until the platform backend can
report them reliably.

## File watching dependency selection

Use `notify` 8.2.0 to watch open workspaces. The crate is CC0-1.0 licensed,
actively maintained, and uses FSEvents on macOS and inotify on Linux behind one
API. The 9.0 line is still a release candidate. Pau batches events itself
instead of using `notify-debouncer-full`: that debouncer releases each path
once it has been quiet for the timeout, so a branch switch arrives as several
updates. Pau waits until the whole workspace has been quiet for 150 ms, or at
most 2 seconds, and sends one update. Ignore rules come from the `ignore`
crate's `.gitignore` matchers, the same rules the file tree uses.

## Terminal dependency selection

Use `portable-pty` 0.9.0 for PTY ownership. The crate is MIT-licensed and is
maintained in the WezTerm repository. Its native Unix backend supports Linux
and macOS through the same API. PTY reads, writes, child waits, and process
control are blocking, so `pau-term` must keep them off Tokio worker threads.
The spike exercised Linux, and the `pau-term` PTY tests pass on macOS.

Use `@xterm/xterm` 6.0.0 with these official MIT-licensed addons from the
xterm.js repository:

- `@xterm/addon-fit` 0.11.0
- `@xterm/addon-search` 0.16.0
- `@xterm/addon-serialize` 0.14.0
- `@xterm/addon-unicode11` 0.9.0
- `@xterm/addon-web-links` 0.12.0
- `@xterm/addon-clipboard` 0.2.0

The Unicode 11 addon uses xterm.js's proposed API and requires
`allowProposedApi`. Fit requires a visible, measured container. Clipboard
access depends on browser permissions and a secure context. Serialization
captures emulator state but does not replace backend scrollback. Web links
need Pau's own allowlist and click handler before they can navigate.

Binary WebSocket frames carry PTY input and output without converting output
to text. Browser text input is UTF-8 encoded, while xterm.js binary events keep
their byte values. Text WebSocket frames carry typed controls such as resize.
The spike keeps the PTY alive across browser reconnects, but a detached client
receives only new output. `pau-term` must provide session ownership, bounded
scrollback and replay, backpressure, staged shutdown, and control validation.
No custom terminal parser, emulator, or PTY layer is justified.

## Editor dependency selection

Use CodeMirror 6 for Pau's built-in file, quick-edit, and diff surfaces. The
initial editor uses `codemirror` 6.0.2 with `@codemirror/state` 6.7.6,
`@codemirror/language` 6.12.4, `@codemirror/language-data` 6.5.2,
`@codemirror/merge` 6.12.2, and `@lezer/highlight` 1.2.4. The language catalog
matches filenames and loads its native and legacy language packages on demand.
Keep language services behind an optional backend supervisor rather than adding
a browser language-server runtime.

External editor launch uses each editor's documented command-line interface and
Rust process APIs. It does not require an editor plugin or a shared editor
protocol. Keep known argument mappings for Neovim, Vim, Helix, Visual Studio
Code, and Zed, and allow an explicit command template for another editor.
Terminal editors run through the selected PTY and xterm.js stack.

Do not add a Neovim RPC client or browser grid renderer in the first release. A
previous spike proved that `nvim --embed` can provide redraw, input, and resize,
but a complete integration also owns rendering, multigrid, clipboard, input,
configuration, theming, version compatibility, and reconnect behavior. Revisit
those dependencies only if deep embedding becomes a separate product priority.

## Markdown dependency selection

Use `marked` 18.1.1 to lex assistant messages into Markdown tokens. The library
is MIT-licensed, actively maintained, and small, with a lexer that is separate
from its HTML renderer. Pau renders the tokens with Svelte components instead
of the HTML renderer, so no HTML string is built or injected and raw HTML in a
message shows as text. A sanitizer such as DOMPurify would add a second
dependency to guard output Pau never produces. Links open only for `http`,
`https`, and `mailto` addresses, and images show their alt text.
