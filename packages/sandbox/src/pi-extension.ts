/**
 * Pi extension that moves every built-in file, search, and command tool into a
 * sandboxed tool host. Pi, its provider traffic, and its model credentials stay
 * in the RPC host process.
 *
 * Pau writes the session's policy to the file named by
 * `PAU_SANDBOX_POLICY_FILE` and rewrites it to change grants. Tools without a
 * contained launch path are disabled. The operator may enable one to run
 * outside the sandbox, and each of its calls then asks for approval.
 */
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionContext
} from '@earendil-works/pi-coding-agent';
import { explainFailure } from './denials.ts';
import { SandboxUnavailableError } from './launcher.ts';
import { startMcpRelays } from './mcp-relay.ts';
import type { PreloadDenial } from './preload.ts';
import { SandboxSession } from './sandbox-session.ts';
import { sandboxedToolNames, type SandboxedToolName } from './tool-host-protocol.ts';

const definitions = {
	read: createReadToolDefinition,
	write: createWriteToolDefinition,
	edit: createEditToolDefinition,
	bash: createBashToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition
} satisfies Record<SandboxedToolName, unknown>;

/**
 * pi-mcp-adapter's tools may run under the profile only when Pau started Pi
 * with a session MCP configuration that lists contained servers alone.
 */
const MCP_ADAPTER_SOURCE = /[/\\]pi-mcp-adapter[/\\]/;

/**
 * Why MCP servers may be running in the Pi process, outside the sandbox, or
 * `null`.
 *
 * Without a session MCP configuration, Pau found no MCP adapter, and this
 * extension registers the only `/mcp` command, which keeps Pi's built-in MCP
 * support off. Any MCP tool, or a second `/mcp` command, then comes from an
 * adapter Pau missed, whose servers start in the Pi process. The session
 * must fail instead of running them.
 */
export function unsandboxedMcp(
	policy: { mcpConfig: string | null },
	tools: Array<{ name: string; sourceInfo: { path: string } }>,
	commands: Array<{ name: string }>
): string | null {
	if (policy.mcpConfig !== null) return null;
	const mcpTools = tools
		.filter(
			(tool) => tool.name === 'mcp' || tool.name.startsWith('mcp__') || MCP_ADAPTER_SOURCE.test(tool.sourceInfo.path)
		)
		.map((tool) => tool.name);
	if (mcpTools.length > 0) {
		return `an extension Pau did not recognize as an MCP adapter registered MCP tools (${mcpTools.join(', ')}), and its servers would run outside the sandbox`;
	}
	if (commands.filter((command) => /^mcp(:\d+)?$/.test(command.name)).length > 1) {
		return 'an extension Pau did not recognize as an MCP adapter registered /mcp, and its servers would run outside the sandbox';
	}
	return null;
}

/**
 * Status key of the record that tells Pau whether the tool host started. Its
 * text is `{"state":"ready"}` or `{"state":"unavailable","message":…}`. Pau
 * waits for it before a sandboxed session counts as started and never shows
 * it.
 */
const READINESS_STATUS_KEY = 'pau.sandbox';

export default function pauSandbox(pi: ExtensionAPI): void {
	const policyFile = process.env.PAU_SANDBOX_POLICY_FILE;
	if (!policyFile) throw new Error('PAU_SANDBOX_POLICY_FILE is required when the Pau sandbox extension is loaded');
	let context: ExtensionContext | undefined;
	const session = new SandboxSession(policyFile, process.env.PATH ?? '', (message, level) => {
		process.stderr.write(`[pau-sandbox] ${message}\n`);
		context?.ui.notify(message, level);
	});
	const builtIn = new Set<string>(sandboxedToolNames);
	const stopRelays = startMcpRelays(session, session.policy.mcpServers);
	session.watch();

	const containedMcpTool = (name: string): boolean =>
		session.policy.mcpConfig !== null &&
		pi.getAllTools().some((tool) => tool.name === name && MCP_ADAPTER_SOURCE.test(tool.sourceInfo.path));

	for (const name of sandboxedToolNames) {
		const local = definitions[name](session.policy.workspace);
		pi.registerTool({
			...(local as ReturnType<typeof createReadToolDefinition>),
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const call = {
					tool: name,
					toolCallId,
					params,
					session: {
						id: ctx.sessionManager.getSessionId(),
						file: ctx.sessionManager.getSessionFile(),
						model: ctx.model,
						thinkingLevel: pi.getThinkingLevel()
					}
				};
				let observed: PreloadDenial[] = [];
				// Tell the model what the sandbox blocked so it does not retry blindly.
				const explain = (message: string): string | undefined =>
					explainFailure(session.policy, name, params, message, observed).note;
				try {
					const result = await session.run(async (client) => {
						// Native reports belong to the session rather than a tool request.
						// Discard reports completed before this call to avoid stale attribution.
						await client.takeDenials();
						try {
							const result = await client.executeTool(call, signal, onUpdate as never);
							// Unified logging is asynchronous. Wait only after a failed call.
							if (result.isError) observed = await client.takeDenials(500);
							return result;
						} catch (error) {
							observed = await client.takeDenials(500);
							throw error;
						}
					});
					// A tool fails either by throwing or, like bash on a non-zero exit, by
					// returning an error result.
					if (!result.isError) return result as never;
					const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
					const note = explain(text);
					return (note ? { ...result, content: [...result.content, { type: 'text', text: note }] } : result) as never;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const note = explain(message);
					if (!note) throw error;
					throw new Error(`${message}\n\n${note}`, { cause: error });
				}
			}
		});
	}

	// Pi's built-in MCP support starts the servers in its `mcp.json` files in
	// the Pi process, outside the sandbox. Pi leaves that built-in extension
	// out when another extension registers `/mcp`, and has no flag to turn it
	// off. pi-mcp-adapter registers `/mcp` itself whenever Pau gives it a
	// session MCP configuration, and a second `/mcp` would rename both.
	if (session.policy.mcpConfig === null) {
		pi.registerCommand('mcp', {
			description: 'MCP servers are unavailable while the Pau sandbox is active',
			async handler(_args, ctx) {
				ctx.ui.notify("Pi's built-in MCP support does not run in sandboxed sessions yet.", 'warning');
			}
		});
	}

	pi.on('user_bash', () => ({
		operations: { exec: (command, _cwd, options) => session.run((client) => client.executeBash(command, options)) }
	}));

	const reportReadiness = async (ctx: ExtensionContext): Promise<void> => {
		let state: Record<string, string> = { state: 'ready' };
		try {
			await session.connect();
			// Checked after the tool host starts, which gives an adapter's
			// eager servers time to register their tools.
			const reason = unsandboxedMcp(session.policy, pi.getAllTools(), pi.getCommands());
			if (reason !== null) state = { state: 'unavailable', message: reason };
		} catch (error) {
			const message =
				error instanceof SandboxUnavailableError
					? error.reasons.join('; ')
					: error instanceof Error
						? error.message
						: String(error);
			state = { state: 'unavailable', message };
		}
		ctx.ui.setStatus(READINESS_STATUS_KEY, JSON.stringify(state));
	};

	pi.on('session_start', (_event, ctx) => {
		context = ctx;
		const enabled = new Set(session.policy.unsandboxedTools);
		const active = pi.getActiveTools();
		const kept = active.filter((name) => builtIn.has(name) || enabled.has(name) || containedMcpTool(name));
		const disabled = active.filter((name) => !kept.includes(name));
		pi.setActiveTools([...new Set([...sandboxedToolNames, ...kept])]);
		if (disabled.length > 0) {
			process.stderr.write(`[pau-sandbox] disabled unreviewed tools: ${disabled.join(', ')}\n`);
		}
		// Start the tool host now, so a sandbox that cannot start fails the
		// session start instead of the first tool call. Pi does not wait for it.
		void reportReadiness(ctx);
	});

	// A second guard for tools that another extension activates later, and the
	// per-call approval for tools the operator enabled outside the sandbox.
	pi.on('tool_call', async (event, ctx) => {
		if (builtIn.has(event.toolName) || containedMcpTool(event.toolName)) return;
		if (!session.policy.unsandboxedTools.includes(event.toolName)) {
			return { block: true, reason: `${event.toolName} is unavailable while the Pau sandbox is active` };
		}
		let approved = false;
		try {
			approved = await ctx.ui.confirm(
				`Run ${event.toolName} outside the sandbox?`,
				`This call runs with your normal access to files, network, and credentials. The sandbox does not apply to it.`
			);
		} catch {
			// A dialog that cannot be answered denies the call.
		}
		return approved
			? undefined
			: { block: true, reason: `The operator did not approve running ${event.toolName} outside the sandbox` };
	});

	pi.on('session_shutdown', async () => {
		stopRelays();
		await session.stop();
	});
}
