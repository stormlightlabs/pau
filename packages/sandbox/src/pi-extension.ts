/**
 * Pi extension that moves every built-in file, search, and command tool into a
 * sandboxed tool host. Pi, its provider traffic, and its model credentials stay
 * in the RPC host process.
 *
 * Pau supplies the policy in `PAU_SANDBOX_POLICY` as a JSON
 * {@link SandboxPolicyInput}. Tools from other extensions are blocked while the
 * policy is active because their execution boundary has not been reviewed.
 */
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI
} from '@earendil-works/pi-coding-agent';
import type { SandboxPolicyInput } from './profile.ts';
import { ToolHostClient } from './tool-host-client.ts';
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

export default function pauSandbox(pi: ExtensionAPI): void {
	const source = process.env.PAU_SANDBOX_POLICY;
	if (!source) throw new Error('PAU_SANDBOX_POLICY is required when the Pau sandbox extension is loaded');
	const policy = JSON.parse(source) as SandboxPolicyInput;
	const allowed = new Set<string>(sandboxedToolNames);
	let host: Promise<ToolHostClient> | undefined;

	// Start lazily and keep a failed start: every later call reports the same
	// error instead of retrying or falling back to the Pi process.
	const connect = (): Promise<ToolHostClient> => (host ??= ToolHostClient.start(policy, process.env.PATH ?? ''));

	for (const name of sandboxedToolNames) {
		const local = definitions[name](policy.workspace);
		pi.registerTool({
			...(local as ReturnType<typeof createReadToolDefinition>),
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const client = await connect();
				const session = {
					id: ctx.sessionManager.getSessionId(),
					file: ctx.sessionManager.getSessionFile(),
					model: ctx.model,
					thinkingLevel: pi.getThinkingLevel()
				};
				const call = { tool: name, toolCallId, params, session };
				return (await client.executeTool(call, signal, onUpdate as never)) as never;
			}
		});
	}

	pi.on('user_bash', () => ({
		operations: {
			exec: async (command, _cwd, options) => {
				const client = await connect();
				return client.executeBash(command, options);
			}
		}
	}));

	pi.on('session_start', () => {
		const disabled = pi.getActiveTools().filter((name) => !allowed.has(name));
		pi.setActiveTools(sandboxedToolNames);
		if (disabled.length > 0) {
			process.stderr.write(`[pau-sandbox] disabled unreviewed tools: ${disabled.join(', ')}\n`);
		}
	});

	// A second guard for tools that another extension activates later.
	pi.on('tool_call', (event) =>
		allowed.has(event.toolName)
			? undefined
			: { block: true, reason: `${event.toolName} is unavailable while the Pau sandbox is active` }
	);

	pi.on('session_shutdown', async () => {
		const pending = host;
		host = undefined;
		if (!pending) return;
		try {
			const client = await pending;
			await client.stop();
		} catch {
			// A failed start has already released the sandbox.
		}
	});
}
