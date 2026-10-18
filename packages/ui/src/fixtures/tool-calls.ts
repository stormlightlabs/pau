import type { TranscriptTool } from '../lib/types/session';

const longLog = Array.from({ length: 1200 }, (_, index) => `test ${index + 1} ... ok`).join('\n');

/** Tool calls covering each built-in view, every status, and the text fallback. */
export const toolCallFixtures = {
	bashRunning: {
		id: 'bash-running',
		kind: 'tool',
		name: 'bash',
		detail: 'pnpm test',
		result: 'RUN  v4.1.11\n✓ src/diff/gutter.test.ts (6)',
		status: 'running',
		call: { tool: 'bash', command: 'pnpm test' }
	},
	bashComplete: {
		id: 'bash-complete',
		kind: 'tool',
		name: 'bash',
		detail: 'git status --short',
		result: ' M src/diff/gutter.ts\n?? src/diff/wrap.test.ts\n',
		status: 'complete',
		call: { tool: 'bash', command: 'git status --short', exitCode: 0, durationMs: 84 }
	},
	bashFailed: {
		id: 'bash-failed',
		kind: 'tool',
		name: 'bash',
		detail: 'cargo test -p pau-pi',
		result: 'error[E0425]: cannot find value `rows` in this scope\n\nCommand exited with code 101',
		status: 'failed',
		call: { tool: 'bash', command: 'cargo test -p pau-pi', exitCode: 101, durationMs: 12_400 }
	},
	bashTruncated: {
		id: 'bash-truncated',
		kind: 'tool',
		name: 'bash',
		detail: 'cargo test --workspace',
		result: longLog,
		status: 'complete',
		call: {
			tool: 'bash',
			command: 'cargo test --workspace',
			exitCode: 0,
			durationMs: 95_000,
			truncation: { truncatedBy: 'lines', totalLines: 4800, outputLines: 1200 },
			fullOutputPath: '/tmp/pi-bash-7f3a.log'
		}
	},
	read: {
		id: 'read',
		kind: 'tool',
		name: 'read',
		detail: 'src/diff/gutter.ts',
		result:
			"import { lineOffsets } from './offsets';\n\nexport function gutterRows(view) {\n\treturn lineOffsets(view);\n}\n",
		status: 'complete',
		call: { tool: 'read', path: 'src/diff/gutter.ts', offset: 10, limit: 5 }
	},
	readTruncated: {
		id: 'read-truncated',
		kind: 'tool',
		name: 'read',
		detail: 'CHANGELOG.md',
		result: Array.from({ length: 450 }, (_, index) => `- Change ${index + 1}`).join('\n'),
		status: 'complete',
		call: {
			tool: 'read',
			path: 'CHANGELOG.md',
			truncation: { truncatedBy: 'bytes', totalLines: 3000, outputLines: 450 }
		}
	},
	edit: {
		id: 'edit',
		kind: 'tool',
		name: 'edit',
		detail: 'README.md',
		result: 'Successfully replaced 1 block(s) in README.md.',
		status: 'complete',
		call: {
			tool: 'edit',
			path: 'README.md',
			edits: [{ oldText: 'Old intro', newText: 'New intro' }],
			diff: ' 1 # Pau\n-2 Old intro\n+2 New intro\n 3 ',
			firstChangedLine: 2
		}
	},
	editRunning: {
		id: 'edit-running',
		kind: 'tool',
		name: 'edit',
		detail: 'src/diff/gutter.ts',
		status: 'running',
		call: {
			tool: 'edit',
			path: 'src/diff/gutter.ts',
			edits: [{ oldText: 'return lineOffsets(view);', newText: 'return visualLineOffsets(view);' }]
		}
	},
	editFailed: {
		id: 'edit-failed',
		kind: 'tool',
		name: 'edit',
		detail: 'src/diff/gutter.ts',
		result: 'Could not find the exact text in src/diff/gutter.ts.',
		status: 'failed',
		call: { tool: 'edit', path: 'src/diff/gutter.ts', edits: [{ oldText: 'rows()', newText: 'visualRows()' }] }
	},
	write: {
		id: 'write',
		kind: 'tool',
		name: 'write',
		detail: 'src/diff/wrap.test.ts',
		result: 'Successfully wrote 96 bytes to src/diff/wrap.test.ts',
		status: 'complete',
		call: {
			tool: 'write',
			path: 'src/diff/wrap.test.ts',
			content: "import { test } from 'vitest';\n\ntest('wraps folded ranges', () => {});\n"
		}
	},
	extension: {
		id: 'extension',
		kind: 'tool',
		name: 'todo',
		detail: '{"action":"add","text":"Cover folded ranges"}',
		result: 'Added todo #3: Cover folded ranges',
		status: 'complete'
	}
} satisfies Record<string, TranscriptTool>;
