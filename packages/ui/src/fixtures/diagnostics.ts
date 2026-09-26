import type { DiagnosticBundleView } from '../lib/types/diagnostics';

/** Representative redacted release diagnostics for stories and tests. */
export const diagnosticFixtures: Record<'active' | 'disabled', DiagnosticBundleView> = {
	active: {
		frontendVersion: '0.1.0',
		backendVersion: '0.1.0',
		dependencies: { axum: '0.8.8', tokio: '1.49.0', svelte: '5.57.1' },
		adapters: [
			{
				name: 'Pi',
				version: '0.52.0',
				handshake: 'ready',
				capabilities: ['prompt', 'interrupt', 'resume', 'extension UI']
			},
			{ name: 'Claude Code', version: '2.1.259', handshake: 'ready', capabilities: ['prompt', 'interrupt', 'resume'] }
		],
		transports: [
			{
				name: 'WebSocket',
				state: 'connected',
				reconnects: 2,
				lastSequence: 842,
				replayGaps: 0,
				queueDepth: 4,
				droppedUpdates: 0
			},
			{
				name: 'Pi RPC',
				state: 'ready',
				reconnects: 0,
				lastSequence: 184,
				replayGaps: 1,
				queueDepth: 0,
				droppedUpdates: 3
			}
		],
		settings: { enabled: true, minLevel: 'info', payloadTracing: false },
		records: [
			{
				timestamp: '2026-04-01T12:10:42Z',
				component: 'pau-server',
				level: 'warn',
				operation: 'event.replay_gap',
				sessionId: 'diff-gutter',
				metadata: { sequence: '842', replay_gap: '1' },
				payloadTrace: false
			},
			{
				timestamp: '2026-04-01T12:10:39Z',
				component: 'pau-agent',
				level: 'info',
				operation: 'process.started',
				processId: 'process-7',
				sessionId: 'diff-gutter',
				metadata: { pid: '7312', state: 'running' },
				payloadTrace: false
			}
		],
		droppedRecords: 12,
		revision: 48
	},
	disabled: {
		frontendVersion: '0.1.0',
		backendVersion: '0.1.0',
		dependencies: { axum: '0.8.8', tokio: '1.49.0' },
		adapters: [],
		transports: [],
		settings: { enabled: false, minLevel: 'info', payloadTracing: false },
		records: [],
		droppedRecords: 0,
		revision: 0
	}
};
