import { expect, test, vi } from 'vitest';

import { copyText, findMessage, lastAssistantReply } from '../lib/clipboard';
import type { TranscriptEntry } from '../lib/types/session';
import { stubClipboard } from './clipboard-stub';

const transcript: TranscriptEntry[] = [
	{ id: 'u1', kind: 'message', role: 'user', body: 'Fix it' },
	{ id: 'a1', kind: 'message', role: 'assistant', body: 'First **reply**' },
	{ id: 't1', kind: 'tool', name: 'read', detail: 'a.ts', status: 'complete' },
	{ id: 'a2', kind: 'message', role: 'assistant', body: '' }
];

test('copies text and reports a rejected or missing clipboard as a readable error', async () => {
	const writeText = stubClipboard();
	expect(await copyText('hi')).toEqual({ ok: true });
	expect(writeText).toHaveBeenCalledWith('hi');

	stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
	expect(await copyText('hi')).toEqual({ ok: false, error: 'The clipboard refused the copy.' });

	Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
	expect(await copyText('hi')).toEqual({ ok: false, error: 'The clipboard is not available here.' });
});

test('finds messages by id and the last assistant reply with text', () => {
	expect(findMessage(transcript, 'u1')?.body).toBe('Fix it');
	expect(findMessage(transcript, 't1')).toBeUndefined();
	expect(lastAssistantReply(transcript)?.id).toBe('a1');
	expect(lastAssistantReply([transcript[0]!])).toBeUndefined();
});
