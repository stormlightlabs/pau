/**
 * Pi extension that gates every tool call with the per-session policy Pau
 * writes to `PAU_PERMISSION_POLICY_FILE`.
 *
 * Pau loads it with `--extension` only for a confirming permission profile,
 * before the sandbox extension, so a denied call never reaches the sandbox.
 * Requests and decisions travel over Pi's RPC extension UI; see messages.ts.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { PermissionController } from './controller.ts';
import type { ToolAnnotations } from './gate.ts';
import { loadPolicy } from './policy.ts';

export default function pauPermissions(pi: ExtensionAPI): void {
	// Pi reports the annotations an MCP server declares for each tool. Before
	// Pi 0.99 there are none, so every MCP tool asks.
	const annotationsOf = (name: string): ToolAnnotations | undefined =>
		pi.getAllTools().find((tool) => tool.name === name)?.annotations;
	const controller = new PermissionController(() => loadPolicy(), annotationsOf);

	pi.on('session_start', (event) => {
		// The factory already loaded the policy for the first session.
		if (event.reason !== 'startup') controller.reset();
	});
	pi.on('session_shutdown', () => controller.clearApprovals());
	pi.on('tool_call', (event, ctx) => controller.handle(event, ctx.ui, ctx.signal));
}
