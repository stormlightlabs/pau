/**
 * Test-only Pi extension for the permission fixture runs. It registers Pi's
 * faux model with the scripted tool calls in `PAU_FIXTURE_SCRIPT` and an
 * MCP-named tool that writes a marker file, so a run proves whether the tool
 * executed.
 */
import { writeFileSync } from 'node:fs';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/** One scripted model turn that calls a single tool. */
export type FixtureStep = { tool: string; args: Parameters<typeof fauxToolCall>[1] };

export default function fixtureExtension(pi: ExtensionAPI): void {
	const script = JSON.parse(process.env.PAU_FIXTURE_SCRIPT ?? '[]') as FixtureStep[];
	const faux = fauxProvider({ provider: 'pau-faux', models: [{ id: 'scripted' }] });
	faux.setResponses([
		...script.map((step, index) =>
			fauxAssistantMessage(fauxToolCall(step.tool, step.args, { id: `call-${index}` }), { stopReason: 'toolUse' })
		),
		fauxAssistantMessage('done')
	]);
	pi.registerProvider(faux.provider);

	pi.registerTool({
		name: 'mcp__probe__lookup',
		label: 'Probe lookup',
		description: 'Writes a marker file to show that the call ran.',
		parameters: Type.Object({ path: Type.String() }),
		async execute(_toolCallId, params) {
			writeFileSync(params.path, 'looked up\n');
			return { content: [{ type: 'text', text: 'looked up' }], details: undefined };
		}
	});
}
