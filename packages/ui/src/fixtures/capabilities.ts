/** Fixture data for UI states that depend on agent capabilities. */
export type CapabilityFixture = { id: string; label: string; description: string; available: boolean };

/** Representative capability states for stories and component tests. */
export const capabilityFixtures = {
	available: {
		id: 'prompt',
		label: 'Send prompts',
		description: 'The connected agent accepts new prompts while this session is idle.',
		available: true
	},
	unavailable: {
		id: 'branch',
		label: 'Branch sessions',
		description: 'This adapter does not provide native session branching.',
		available: false
	}
} satisfies Record<'available' | 'unavailable', CapabilityFixture>;
