import { expect, test } from 'vitest';

import { largeResourceIndex, resourceIndex } from '../fixtures/resources';
import {
	NO_RESOURCE_FILTER,
	countByKind,
	filterResources,
	resourceAttention,
	resourceKindFromSegment
} from '../lib/resource-browser';
import type { ResourceEntry } from '../lib/types/resources';

const names = (resources: ResourceEntry[]) => resources.map((resource) => resource.name);

test('filters one kind by name, scope, and trust', () => {
	const skills = largeResourceIndex.resources;
	expect(filterResources(skills, 'skill', NO_RESOURCE_FILTER)).toHaveLength(300);
	expect(filterResources(skills, 'prompt', NO_RESOURCE_FILTER)).toHaveLength(0);
	expect(names(filterResources(skills, 'skill', { ...NO_RESOURCE_FILTER, query: '  SKILL-29 ' }))).toEqual(
		Array.from({ length: 10 }, (_, digit) => `skill-29${digit}`)
	);
	expect(filterResources(skills, 'skill', { ...NO_RESOURCE_FILTER, scope: 'project' })).toHaveLength(100);
	expect(filterResources(skills, 'skill', { ...NO_RESOURCE_FILTER, trust: 'trusted' })).toHaveLength(200);
	expect(filterResources(skills, 'skill', { query: '003', scope: 'project', trust: 'undecided' })).toHaveLength(1);
});

test('counts every kind and reads view segments', () => {
	expect(countByKind(resourceIndex.resources)).toEqual({ skill: 35, prompt: 22, extension: 10, theme: 6, package: 5 });
	expect(resourceKindFromSegment('prompts')).toBe('prompt');
	expect(resourceKindFromSegment('packages')).toBe('package');
	expect(resourceKindFromSegment('nonsense')).toBe('skill');
	expect(resourceKindFromSegment(undefined)).toBe('skill');
});

test('shows the most severe state of a resource', () => {
	const ready = resourceIndex.resources[0]!;
	expect(resourceAttention(ready)).toBeUndefined();
	expect(resourceAttention({ ...ready, warnings: ['a', 'b'] })).toEqual({ label: '2 warnings', tone: 'warning' });
	expect(resourceAttention({ ...ready, trust: 'undecided', warnings: ['a'] })).toEqual({
		label: 'Trust not decided',
		tone: 'warning'
	});
	expect(resourceAttention({ ...ready, status: 'duplicate', trust: 'untrusted' })?.label).toBe('Duplicate');
	expect(resourceAttention({ ...ready, status: 'invalid' })).toEqual({ label: 'Invalid', tone: 'danger' });
	expect(resourceAttention({ ...ready, status: 'missing' })).toEqual({ label: 'Not installed', tone: 'danger' });
});
