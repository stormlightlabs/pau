import { sandboxFixtures, type SandboxSelectionModel } from '@stormlightlabs/pau-ui';
import { expect, test } from 'vitest';

import { effectiveView, selectionView, selectionWire } from './sandbox-model';

test('round-trips selections between the wire and the settings view', () => {
	for (const selection of [sandboxFixtures.unsandboxed, sandboxFixtures.granted]) {
		expect(selectionView(selectionWire(selection))).toEqual(selection);
	}
	expect(selectionWire(sandboxFixtures.granted)).toMatchObject({
		mode: 'sandboxed',
		settings: { grants: { writable_roots: ['/home/me/.cache/pnpm'] }, home_read_deny: true }
	});
	const referenced = {
		mode: 'sandboxed',
		settings: {
			...sandboxFixtures.granted.settings,
			credentialReferences: [{ source: 'PACKAGE_TOKEN', shape: 'url-password', destinations: ['registry.example.com'] }]
		}
	} satisfies SandboxSelectionModel;
	expect(selectionView(selectionWire(referenced))).toEqual(referenced);
});

test('maps the effective profile without dropping restrictions', () => {
	const view = effectiveView({
		adapter: 'claude',
		platform: 'linux',
		mechanism: 'Bubblewrap 0.12.0',
		verified: true,
		executables: [{ name: 'rg', path: '/usr/bin/rg', version: null }],
		profile: 'read-only',
		readable: { home_denied: true, allowed: ['/work'], denied: ['/home/me'] },
		writable: ['/tmp/s'],
		protected: ['/work/.pi'],
		network: { domains: ['127.0.0.1:8080'], local_addresses: ['127.0.0.1:8080'], unix_sockets: false },
		credentials: {
			denied: ['/home/me/.ssh'],
			references: [{ source: 'PACKAGE_TOKEN', shape: 'colon-pair', destinations: ['registry.example.com'] }],
			brokered: []
		},
		environment: ['HOME'],
		limits: ['Core dumps are disabled'],
		sandboxed_tools: ['Bash'],
		unsandboxed_tools: ['WebFetch'],
		disabled_tools: ['WebSearch'],
		placeholders: ['/work/.mcp.json'],
		known_gaps: ['gap']
	});
	expect(view.readable).toEqual({ homeDenied: true, allowed: ['/work'], denied: ['/home/me'] });
	expect(view.network.localAddresses).toEqual(['127.0.0.1:8080']);
	expect(view.executables[0]?.version).toBeUndefined();
	expect(view.credentials.references).toEqual([
		{ source: 'PACKAGE_TOKEN', shape: 'colon-pair', destinations: ['registry.example.com'] }
	]);
	expect(view.unsandboxedTools).toEqual(['WebFetch']);
	expect(view.knownGaps).toEqual(['gap']);
});
