import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Exercises Pau's supported RPC extension UI surface without calling a model. */
export default function extensionUiFixture(pi: ExtensionAPI) {
	pi.registerCommand('pau-extension-ui-fixture', {
		description: 'Exercise supported extension UI requests',
		handler: async (_args, ctx) => {
			ctx.ui.notify('Fixture ready', 'info');
			ctx.ui.setStatus('fixture', 'Waiting for responses');
			ctx.ui.setWidget('fixture', ['Configured extension', 'String widget'], { placement: 'aboveEditor' });

			await ctx.ui.confirm('Confirm fixture', 'Continue through the fixture?');
			await ctx.ui.select('Select fixture', ['One', 'Two']);
			await ctx.ui.input('Input fixture', 'Enter a value');
			await ctx.ui.editor('Editor fixture', 'Line one\nLine two');
			await ctx.ui.select('Timeout fixture', ['Wait'], { timeout: 25 });

			const customResult = await ctx.ui.custom(() => ({
				invalidate() {},
				render() {
					return ['Terminal-only fixture'];
				}
			}));
			if (customResult === undefined && ctx.mode === 'rpc') {
				ctx.ui.notify('Terminal-only custom UI requires vanilla Pi in a Pau terminal.', 'warning');
			}

			ctx.ui.setWidget('fixture', undefined);
			ctx.ui.setStatus('fixture', undefined);
		}
	});
}
