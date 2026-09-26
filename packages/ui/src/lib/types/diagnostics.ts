/** Severity retained by release diagnostics. */
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

/** Observation-only diagnostic settings. */
export type DiagnosticSettings = {
	enabled: boolean;
	minLevel: DiagnosticLevel;
	payloadTracing: boolean;
	payloadTracingExpiresAt?: number;
};

/** One adapter version and capability handshake. */
export type AdapterDiagnostic = { name: string; version?: string; handshake: string; capabilities: string[] };

/** Current transport, replay, and queue state. */
export type TransportDiagnostic = {
	name: string;
	state: string;
	reconnects: number;
	lastSequence?: number;
	replayGaps: number;
	queueDepth: number;
	droppedUpdates: number;
};

/** One sanitized metadata record. */
export type DiagnosticRecord = {
	timestamp: string;
	component: string;
	level: DiagnosticLevel;
	operation: string;
	processId?: string;
	sessionId?: string;
	metadata: Record<string, string>;
	payloadTrace: boolean;
};

/** Redacted snapshot shown before export. */
export type DiagnosticBundleView = {
	frontendVersion: string;
	backendVersion: string;
	dependencies: Record<string, string>;
	adapters: AdapterDiagnostic[];
	transports: TransportDiagnostic[];
	settings: DiagnosticSettings;
	records: DiagnosticRecord[];
	droppedRecords: number;
	revision: number;
};
