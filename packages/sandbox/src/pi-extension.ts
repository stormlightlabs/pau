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
				try {
					return (await session.run(async (client) => {
						// Native reports belong to the session rather than a tool request.
						// Discard reports completed before this call to avoid stale attribution.
						await client.takeDenials();
						try {
							return await client.executeTool(call, signal, onUpdate as never);
						} catch (error) {
							// Unified logging is asynchronous. Wait only after a failed call.
							observed = await client.takeDenials(500);
							throw error;
						}
					})) as never;
				} catch (error) {
					// Tell the model what the sandbox blocked so it does not retry blindly.
					const message = error instanceof Error ? error.message : String(error);
					const { note } = explainFailure(session.policy, name, params, message, observed);
					if (!note) throw error;
					throw new Error(`${message}\n\n${note}`, { cause: error });
				}
			}
		});
	}

	pi.on('user_bash', () => ({
		operations: { exec: (command, _cwd, options) => session.run((client) => client.executeBash(command, options)) }
	}));

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
