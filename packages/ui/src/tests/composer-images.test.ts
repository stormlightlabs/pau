import { describe, expect, test } from 'vitest';

import {
	encodeImage,
	imageDragKind,
	imageRejection,
	maxImageBytes,
	maxRequestImageBytes
} from '../lib/composer-images';

function file(name: string, type: string, size = 4): File {
	return new File([new Uint8Array(size)], name, { type });
}

describe('imageRejection', () => {
	test('accepts the four supported types', () => {
		for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
			expect(imageRejection(file('a', type), 0)).toBeUndefined();
		}
	});

	test('names a file with an unsupported type', () => {
		expect(imageRejection(file('notes.pdf', 'application/pdf'), 0)).toContain('notes.pdf');
		expect(imageRejection(file('logo.svg', 'image/svg+xml'), 0)).toContain('logo.svg');
	});

	test('rejects a file over 5 MiB but accepts exactly 5 MiB', () => {
		expect(imageRejection(file('big.png', 'image/png', maxImageBytes + 1), 0)).toContain('big.png');
		expect(imageRejection(file('edge.png', 'image/png', maxImageBytes), 0)).toBeUndefined();
	});

	test('rejects a file that takes the request over 10 MiB', () => {
		const next = file('c.png', 'image/png', 1024);
		expect(imageRejection(next, maxRequestImageBytes - 1024)).toBeUndefined();
		expect(imageRejection(next, maxRequestImageBytes - 1023)).toContain('c.png');
	});
});

describe('encodeImage', () => {
	test('returns base64 data without the data URL prefix', async () => {
		const png = new File([new Uint8Array([104, 105])], 'a.png', { type: 'image/png' });
		expect(await encodeImage(png)).toEqual({ mimeType: 'image/png', data: 'aGk=' });
	});
});

describe('imageDragKind', () => {
	/** Node has no DataTransfer, so the test passes only the items the classifier reads. */
	const transfer = (...types: string[]) =>
		({ items: types.map((type) => ({ kind: 'file', type })) }) as unknown as DataTransfer;

	test('tells images, unsupported files, and a mix apart', () => {
		expect(imageDragKind(transfer('image/png', 'image/webp'))).toBe('images');
		expect(imageDragKind(transfer('application/pdf'))).toBe('unsupported');
		expect(imageDragKind(transfer('image/png', 'application/pdf'))).toBe('mixed');
	});

	test('gives unknown when the browser hides the file types', () => {
		expect(imageDragKind(transfer(''))).toBe('unknown');
		expect(imageDragKind(transfer())).toBe('unknown');
		expect(imageDragKind(null)).toBe('unknown');
	});
});
