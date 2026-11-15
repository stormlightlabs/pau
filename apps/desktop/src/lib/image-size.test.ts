import { expect, test } from 'vitest';

import { imageSize } from './image-size';

const base64 = (bytes: number[]) => btoa(String.fromCodePoint(...bytes));
/** Reads the size of an image given as bytes. */
const sizeOf = (mimeType: string, bytes: number[]) => imageSize(mimeType, base64(bytes));
const ascii = (text: string) => [...text].map((char) => char.codePointAt(0) ?? 0);
const be16 = (value: number) => [value >> 8, value & 0xff];
const be32 = (value: number) => [...be16(value >>> 16), ...be16(value & 0xff_ff)];
const le16 = (value: number) => [value & 0xff, value >> 8];
const le24 = (value: number) => [value & 0xff, (value >> 8) & 0xff, value >> 16];

const png = (width: number, height: number) => [
	0x89,
	...ascii('PNG\r\n\u{1A}\n'),
	...be32(13),
	...ascii('IHDR'),
	...be32(width),
	...be32(height),
	8,
	6,
	0,
	0,
	0
];
const gif = (width: number, height: number) => [...ascii('GIF89a'), ...le16(width), ...le16(height), 0, 0, 0];
const webp = (chunk: string, body: number[]) => [
	...ascii('RIFF'),
	0,
	0,
	0,
	0,
	...ascii('WEBP'),
	...ascii(chunk),
	0,
	0,
	0,
	0,
	...body,
	...Array.from({ length: 16 }, () => 0)
];
/** A JPEG with an APP0 segment and a comment before its baseline or progressive frame. */
const jpeg = (width: number, height: number, frame = 0xc0) => [
	0xff,
	0xd8,
	0xff,
	0xe0,
	...be16(16),
	...ascii('JFIF\u{0}'),
	1,
	1,
	0,
	0,
	1,
	0,
	1,
	0,
	0,
	0xff,
	0xfe,
	...be16(5),
	...ascii('pau'),
	0xff,
	frame,
	...be16(17),
	8,
	...be16(height),
	...be16(width),
	3
];

test('reads the size from PNG, GIF, WebP and JPEG headers', () => {
	expect(sizeOf('image/png', png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
	expect(sizeOf('image/gif', gif(320, 200))).toEqual({ width: 320, height: 200 });
	expect(sizeOf('image/jpeg', jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
	expect(sizeOf('image/jpeg', jpeg(800, 600, 0xc2))).toEqual({ width: 800, height: 600 });

	// Lossy: frame tag, start code, then 14-bit sizes.
	const lossy = webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(480)]);
	expect(sizeOf('image/webp', lossy)).toEqual({ width: 640, height: 480 });
	// Lossless: signature, then width - 1 and height - 1 packed in 14 bits each.
	const bits = (1023 & 0x3f_ff) | ((767 & 0x3f_ff) << 14);
	const lossless = webp('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24]);
	expect(sizeOf('image/webp', lossless)).toEqual({ width: 1024, height: 768 });
	// Extended: flags and reserved bytes, then 24-bit canvas width - 1 and height - 1.
	const extended = webp('VP8X', [0, 0, 0, 0, ...le24(19_999), ...le24(19_999)]);
	expect(sizeOf('image/webp', extended)).toEqual({ width: 20_000, height: 20_000 });
});

test('reads a size at any byte offset of the base64 text', () => {
	// A longer APP0 shifts the frame so it starts inside a base64 group.
	for (const pad of [0, 1, 2]) {
		const bytes = jpeg(100, 50);
		bytes.splice(4, 2, ...be16(16 + pad));
		bytes.splice(20, 0, ...Array.from({ length: pad }, () => 0));
		expect(sizeOf('image/jpeg', bytes)).toEqual({ width: 100, height: 50 });
	}
});

test('reads no size from a truncated, damaged or mismatched header', () => {
	const cases: [string, number[] | string][] = [
		['image/png', png(10, 10).slice(0, 20)],
		['image/png', [0, ...png(10, 10).slice(1)]],
		['image/png', png(0, 10)],
		['image/gif', gif(10, 10).slice(0, 8)],
		['image/gif', [...ascii('GIF90a'), ...gif(10, 10).slice(6)]],
		['image/webp', webp('VP8 ', [0, 0, 0, 0, 0, 0, ...le16(10), ...le16(10)])],
		['image/webp', webp('ABCD', [])],
		['image/webp', webp('VP8X', []).slice(0, 26)],
		['image/jpeg', jpeg(10, 10).slice(0, 30)],
		['image/jpeg', [0xff, 0xd8, 0xff, 0xda, 0, 2]],
		['image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0]],
		['image/jpeg', [0xff, 0xd8, 0x00, 0x00]],
		['image/jpeg', png(10, 10)],
		['image/svg+xml', png(10, 10)],
		['image/png', '!!!!not base64'],
		['image/png', '']
	];
	for (const [mimeType, data] of cases) {
		expect(imageSize(mimeType, typeof data === 'string' ? data : base64(data)), mimeType).toBeUndefined();
	}
});

test('gives up on a JPEG with too many segments before its frame', () => {
	const comments = Array.from({ length: 2000 }, () => [0xff, 0xfe, 0, 2]).flat();
	const bytes = jpeg(10, 10);
	bytes.splice(2, 0, ...comments);

	expect(sizeOf('image/jpeg', bytes)).toBeUndefined();
});
