# Pau Claude bridge

`@stormlightlabs/pau-claude-bridge` provides the versioned process protocol used
between the Claude bridge and its clients. The package is usable without the Pau
desktop application.

The package exports Claude Code discovery and the protocol codec. Its fixtures
and fake Claude executable support integration tests without launching a paid
Claude session.

## Claude discovery

`discoverClaude()` accepts an optional `executablePath`. When that option is
absent, it searches `PATH` for `claude`. A configured path takes precedence and
must name an executable file.

Discovery runs `claude --version`; it does not start a Claude session. This
release supports Claude Code versions 1.x and 2.x. Discovery rejects missing or
non-executable files, unrecognized version output, failed version commands, and
unsupported versions with a `ClaudeDiscoveryError` and a machine-readable
`code`.

## Wire format

Each stream uses newline-delimited JSON (JSONL). A frame occupies one line and
ends with `\n`; readers also accept `\r\n`. Every frame has `version: 1` and one
of these types:

- `command` sends a named operation and a non-empty correlation ID.
- `response` completes a command with the same ID and either a result or a
  structured error.
- `event` reports an ordered bridge event with a non-negative sequence number.
- `diagnostic` reports bridge or child-process information with a severity.

Commands, responses, and events use the protocol stream. Diagnostics use a
separate diagnostic stream. A stdio bridge writes protocol frames to stdout and
diagnostic frames to stderr. Consumers must never parse stderr as protocol
output or write diagnostics to stdout.

Unknown versions and invalid records produce a decode error for that line. The
decoder resumes at the next newline, so a bad record does not consume the next
valid frame.

## Development

Run the package checks from this directory:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The tests round-trip every frame type, replay malformed and unsupported fixture
records, and run `test/fixtures/fake-claude.mjs` as a child process. The fake
executable emits protocol data on stdout and JSONL diagnostics on stderr.

## License

This package is available under either the MIT License or the Apache License
2.0.
