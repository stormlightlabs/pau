import type { ResourceEntry, ResourceIndex, ResourceKind, ResourceScope } from '../lib/types/resources';

const HOME = '/Users/ada';
const AGENT = `${HOME}/.pi/agent`;
const WORKSPACE = `${HOME}/src/pau`;

const FOLDERS: Record<ResourceScope, Record<Exclude<ResourceKind, 'package'>, string>> = {
	user: {
		skill: `${AGENT}/skills`,
		prompt: `${AGENT}/prompts`,
		extension: `${AGENT}/extensions`,
		theme: `${AGENT}/themes`
	},
	project: {
		skill: `${WORKSPACE}/.pi/skills`,
		prompt: `${WORKSPACE}/.pi/prompts`,
		extension: `${WORKSPACE}/.pi/extensions`,
		theme: `${WORKSPACE}/.pi/themes`
	}
};

const FILES: Record<Exclude<ResourceKind, 'package'>, (name: string) => string> = {
	skill: (name) => `${name}/SKILL.md`,
	prompt: (name) => `${name}.md`,
	extension: (name) => `${name}.ts`,
	theme: (name) => `${name}.json`
};

/** A resource found in a conventional folder, ready and trusted unless overridden. */
function found(
	kind: Exclude<ResourceKind, 'package'>,
	scope: ResourceScope,
	name: string,
	description: string | null,
	overrides: Partial<ResourceEntry> = {}
): ResourceEntry {
	const path = `${FOLDERS[scope][kind]}/${FILES[kind](name)}`;
	return {
		id: path,
		kind,
		name,
		description,
		path,
		scope,
		source_kind: 'directory',
		source: FOLDERS[scope][kind],
		trust: 'trusted',
		status: 'ready',
		winner: null,
		warnings: [],
		...overrides
	};
}

function packageEntry(source: string, scope: ResourceScope, installed: boolean): ResourceEntry {
	const settings = scope === 'user' ? `${AGENT}/settings.json` : `${WORKSPACE}/.pi/settings.json`;
	return {
		id: `package:${scope}:${source}`,
		kind: 'package',
		name: source,
		description: null,
		path: installed ? `${AGENT}/npm/node_modules/${source.replace(/^npm:/, '').replace(/@[^@/]+$/, '')}` : null,
		scope,
		source_kind: 'setting',
		source: settings,
		trust: 'trusted',
		status: installed ? 'ready' : 'missing',
		winner: null,
		warnings: installed ? [] : ['The package is not installed.']
	};
}

const USER_SKILLS: [string, string][] = [
	['code-review', 'Review a diff for correctness, security, and missing tests before merge.'],
	['writing', 'Write and revise prose in plain technical English without AI writing tells.'],
	['svelte-testing', 'Write component and browser tests for Svelte 5 with Vitest.'],
	['rust-errors', 'Design error types with thiserror and keep messages actionable.'],
	['git-history', 'Find when and why a line changed with blame, log -S, and bisect.'],
	['sql-migrations', 'Write forward-only SQLite migrations and test them against fixtures.'],
	['release-notes', 'Draft release notes from merged pull requests grouped by area.'],
	['css-architecture', 'Organize vanilla CSS with tokens, layers, and component classes.'],
	['accessibility-audit', 'Check keyboard paths, names, focus order, and contrast in a UI change.'],
	['performance-profile', 'Profile a slow path with flame graphs and confirm the fix with numbers.'],
	['dependency-update', 'Update a dependency, read its changelog, and run the affected checks.'],
	['incident-review', 'Write a blameless incident review with a timeline and follow-up tasks.'],
	['api-design', 'Shape an HTTP API around resources, errors, and pagination.'],
	['shell-scripts', 'Write portable POSIX shell scripts that fail loudly.'],
	['docker-debug', 'Find why a container exits, hangs, or cannot reach the network.'],
	['regex-explain', 'Explain a regular expression piece by piece and test edge cases.'],
	['changelog', 'Keep a changelog entry per user-visible change.'],
	['typescript-types', 'Model data with discriminated unions and narrow them safely.'],
	['nix-flakes', 'Write and debug Nix flakes for development shells.'],
	['tauri-ipc', 'Expose native capabilities from a Tauri app through narrow commands.'],
	['log-triage', 'Read a large log, find the first error, and trace it to a cause.'],
	['test-flakes', 'Find the cause of a flaky test instead of retrying it.'],
	['security-review', 'Look for injection, path traversal, and secret leakage in a change.'],
	['data-viz', 'Choose a chart for the question and label it so it reads without a legend.']
];

const PROJECT_SKILLS: [string, string][] = [
	['pau-release', 'Cut a Pau release: bump the version, tag, and smoke test the build.'],
	['pau-protocol', 'Change a wire type in pau-core and regenerate the TypeScript protocol.'],
	['pau-storybook', 'Add a Storybook story with typed fixtures for each state of a component.'],
	['fake-pi', 'Write a fake Pi executable for an integration test.'],
	['sandbox-profiles', 'Review a sandbox profile change against the containment fixtures.'],
	['theme-tokens', 'Add a theme by mapping its upstream palette onto semantic tokens.'],
	['worktree-cleanup', 'Remove merged worktrees and their Cargo target directories.'],
	['ui-screenshots', 'Capture app-shell screenshots at 1440 by 900 and 900 pixels wide.']
];

const USER_PROMPTS: [string, string][] = [
	['review', 'Review the staged changes'],
	['explain', 'Explain the selected code to a new contributor'],
	['commit', 'Write a commit message for the staged diff'],
	['test', 'Write tests for the function under the cursor'],
	['refactor', 'Simplify this module without changing behavior'],
	['docs', 'Update the README for the change on this branch'],
	['bug', 'Find the root cause of the bug described below'],
	['summarize', 'Summarize this session for a handoff note'],
	['plan', 'Plan the change before writing code'],
	['pr', 'Draft a pull request description'],
	['perf', 'Find the slowest part of this code path'],
	['rename', 'Rename the symbol and update every caller'],
	['types', 'Tighten the TypeScript types in this file'],
	['deps', 'List outdated dependencies and what changed'],
	['lint', 'Fix the lint errors in the changed files'],
	['changelog', 'Write a changelog entry for this branch']
];

const PROJECT_PROMPTS: [string, string][] = [
	['gates', 'Run the gates for the files this change touches'],
	['story', 'Add a Storybook story for the component'],
	['handoff', 'Write a handoff note on the task'],
	['review', 'Review against the Pau design system'],
	['regen', 'Regenerate the protocol and check the diff']
];

/**
 * A workspace with real resource volumes: two dozen user skills, project
 * skills, prompts, extensions, themes, and packages, with one of each problem
 * the index can report.
 */
export const resourceIndex: ResourceIndex = {
	project_trust: 'trusted',
	resources: [
		...USER_SKILLS.map(([name, description]) => found('skill', 'user', name, description)),
		...PROJECT_SKILLS.map(([name, description]) => found('skill', 'project', name, description)),
		found('skill', 'project', 'Release_Notes', 'Draft notes for the next tag.', {
			warnings: ['Skill name "Release_Notes" may only use lowercase letters, numbers, and hyphens.']
		}),
		found('skill', 'project', 'broken-frontmatter', null, {
			status: 'invalid',
			warnings: ['Malformed frontmatter; skill not loaded.']
		}),
		found('skill', 'user', 'pau-release', 'An older copy of the release steps.', {
			status: 'duplicate',
			winner: `${FOLDERS.project.skill}/pau-release/SKILL.md`,
			warnings: [`Name "pau-release" collides with ${FOLDERS.project.skill}/pau-release/SKILL.md; keeping the first.`]
		}),
		...PROJECT_PROMPTS.map(([name, description]) => found('prompt', 'project', name, description)),
		found('prompt', 'project', 'onboarding', null, {
			status: 'invalid',
			warnings: ['Cannot read file: Permission denied (os error 13)']
		}),
		...USER_PROMPTS.map(([name, description]) =>
			name === 'review'
				? found('prompt', 'user', name, description, {
						status: 'duplicate',
						winner: `${FOLDERS.project.prompt}/review.md`,
						warnings: [`Name "review" collides with ${FOLDERS.project.prompt}/review.md; keeping the first.`]
					})
				: found('prompt', 'user', name, description)
		),
		...['git-status', 'notify', 'todo-tracker', 'web-fetch', 'session-timer', 'model-switcher', 'clipboard'].map(
			(name) => found('extension', 'user', name, null)
		),
		found('extension', 'project', 'pau-checks', null),
		found('extension', 'project', 'fixture-server', null),
		{
			...found('extension', 'user', 'mcp-adapter', null),
			id: `${AGENT}/npm/node_modules/pi-mcp-adapter/extensions/index.ts`,
			path: `${AGENT}/npm/node_modules/pi-mcp-adapter/extensions/index.ts`,
			source_kind: 'package',
			source: 'npm:pi-mcp-adapter@2.37.0'
		},
		...['dusk', 'nord-night', 'catppuccin-mocha', 'gruvbox-dark'].map((name) => found('theme', 'user', name, null)),
		found('theme', 'project', 'pau-brand', null),
		found('theme', 'project', 'contrast', null, {
			status: 'invalid',
			warnings: ['Theme is not valid JSON; not loaded.']
		}),
		packageEntry('npm:pi-mcp-adapter@2.37.0', 'user', true),
		packageEntry('npm:@acme/pi-tools@1.4.2', 'user', true),
		packageEntry('git:github.com/acme/pi-review', 'user', true),
		packageEntry('npm:pi-voice', 'user', false),
		{ ...packageEntry('./tools/pi-local', 'project', true), path: `${WORKSPACE}/.pi/tools/pi-local` }
	],
	warnings: [
		{ path: `${HOME}/shared/skills`, message: 'Path does not exist.' },
		{ path: `${AGENT}/skills/old-link`, message: 'Broken symbolic link.' }
	]
};

/** The same workspace before the operator saves a trust decision. */
export const undecidedResourceIndex: ResourceIndex = {
	...resourceIndex,
	project_trust: 'undecided',
	resources: resourceIndex.resources.map((resource) =>
		resource.scope === 'project' ? { ...resource, trust: 'undecided' } : resource
	)
};

/** The same workspace after the operator declines to trust it. */
export const untrustedResourceIndex: ResourceIndex = {
	...resourceIndex,
	project_trust: 'untrusted',
	resources: resourceIndex.resources.map((resource) =>
		resource.scope === 'project' ? { ...resource, trust: 'untrusted' } : resource
	)
};

/** A workspace where Pi finds nothing. */
export const emptyResourceIndex: ResourceIndex = { project_trust: 'undecided', resources: [], warnings: [] };

/** Three hundred skills across both scopes, for filtering and keyboard movement. */
export const largeResourceIndex: ResourceIndex = {
	project_trust: 'undecided',
	warnings: [],
	resources: Array.from({ length: 300 }, (_, position) => {
		const scope: ResourceScope = position % 3 === 0 ? 'project' : 'user';
		return found('skill', scope, `skill-${String(position).padStart(3, '0')}`, `Fixture skill number ${position}.`, {
			trust: scope === 'project' ? 'undecided' : 'trusted'
		});
	})
};
