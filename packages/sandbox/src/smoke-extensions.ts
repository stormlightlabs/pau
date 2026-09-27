/**
 * Test-only Pi extension for the sandbox smoke run. It registers Pi's faux
 * model with a scripted list of tool calls from `PAU_SMOKE_SCRIPT` and an
 * unreviewed extension tool that the sandbox must block.
 */
import { writeFileSync } from 'node:fs';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/** One scripted model turn that calls a single tool. */
export type SmokeStep = { tool: string; args: Parameters<typeof fauxToolCall>[1] };

export default function smokeExtensions(pi: ExtensionAPI): void {
	const script = JSON.parse(process.env.PAU_SMOKE_SCRIPT ?? '[]') as SmokeStep[];
	const faux = fauxProvider({ provider: 'pau-faux', models: [{ id: 'scripted' }] });
	faux.setResponses([
		...script.map((step, index) =>
			fauxAssistantMessage(fauxToolCall(step.tool, step.args, { id: `call-${index}` }), { stopReason: 'toolUse' })
		),
		fauxAssistantMessage('done')
	]);
	pi.registerProvider(faux.provider);

	pi.registerTool({
		name: 'host_probe',
		label: 'Host probe',
		description: 'Writes a marker file from the Pi host process.',
		parameters: Type.Object({ path: Type.String() }),
		async execute(_toolCallId, params) {
			writeFileSync(params.path, 'written by host tool\n');
			return { content: [{ type: 'text', text: 'written' }], details: undefined };
		}
	});
}
