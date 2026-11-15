/**
 * The most pixels a prompt image in the transcript may hold, 25 megapixels.
 * A browser decodes an image at full size even for a small thumbnail, at four
 * bytes a pixel, so this caps one image near 100 MB of memory. It still fits a
 * 6K display screenshot (6016×3384) and a 24-megapixel photo.
 */
export const maxImagePixels = 25_000_000;

/** Width and height of an image in pixels, as its file header records them. */
export type ImageSize = { width: number; height: number };

/**
 * Decodes `length` bytes starting at byte `offset` of base64 `data`, without
 * decoding the rest. Returns fewer bytes when the data ends first, and none
 * when the slice is not valid base64.
 */
function bytesAt(data: string, offset: number, length: number): Uint8Array {
	const group = Math.floor(offset / 3);
	const skip = offset - group * 3;
	let binary: string;
	try {
		binary = atob(data.slice(group * 4, (group + Math.ceil((skip + length) / 3)) * 4));
	} catch {
		return new Uint8Array();
	}
	return Uint8Array.from(binary.slice(skip, skip + length), (char) => char.codePointAt(0) ?? 0);
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCodePoint(...bytes.subarray(from, to));
const u16be = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const u16le = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const u24le = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
const u32be = (bytes: Uint8Array, at: number) =>
	((bytes[at] << 24) | (bytes[at + 1] << 16) | u16be(bytes, at + 2)) >>> 0;

/** Reads the PNG size from the IHDR chunk, which must come first. */
function pngSize(data: string): ImageSize | undefined {
	const bytes = bytesAt(data, 0, 24);
	if (bytes.length < 24 || ascii(bytes, 0, 8) !== '\u{89}PNG\r\n\u{1A}\n' || ascii(bytes, 12, 16) !== 'IHDR')
		return undefined;
	return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** Reads the GIF logical screen size, which bounds every frame the browser draws. */
function gifSize(data: string): ImageSize | undefined {
	const bytes = bytesAt(data, 0, 10);
	if (bytes.length < 10 || !['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return undefined;
	return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

/** Reads the WebP canvas size from the first chunk: lossy `VP8 `, lossless `VP8L`, or extended `VP8X`. */
function webpSize(data: string): ImageSize | undefined {
	const bytes = bytesAt(data, 0, 30);
	if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return undefined;
	switch (ascii(bytes, 12, 16)) {
		case 'VP8 ': {
			if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
			return { width: u16le(bytes, 26) & 0x3f_ff, height: u16le(bytes, 28) & 0x3f_ff };
		}
		case 'VP8L': {
			if (bytes[20] !== 0x2f) return undefined;
			const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
			return { width: (bits & 0x3f_ff) + 1, height: ((bits >>> 14) & 0x3f_ff) + 1 };
		}
		case 'VP8X': {
			return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
		}
		default: {
			return undefined;
		}
	}
}

/** Most JPEG segments read before the first frame. Real files hold a few dozen. */
const MAX_JPEG_SEGMENTS = 1024;

/**
 * Reads the JPEG size from its first start-of-frame segment, hopping over the
 * segments before it by their lengths so only their headers decode. A file
 * with more than {@link MAX_JPEG_SEGMENTS} segments before its frame counts
 * as damaged, which bounds the work a crafted file can cause.
 */
function jpegSize(data: string): ImageSize | undefined {
	const start = bytesAt(data, 0, 2);
	if (start[0] !== 0xff || start[1] !== 0xd8) return undefined;
	let offset = 2;
	for (let segment = 0; segment < MAX_JPEG_SEGMENTS; segment += 1) {
		const header = bytesAt(data, offset, 9);
		if (header.length < 4 || header[0] !== 0xff) return undefined;
		const marker = header[1];
		// Standalone markers and fill bytes carry no length.
		if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += marker === 0xff ? 1 : 2;
			continue;
		}
		// Start of scan or end of image before any frame: no size to read.
		if (marker === 0xda || marker === 0xd9) return undefined;
		const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isFrame) {
			if (header.length < 9) return undefined;
			return { width: u16be(header, 7), height: u16be(header, 5) };
		}
		const length = u16be(header, 2);
		if (length < 2) return undefined;
		offset += 2 + length;
	}
	return undefined;
}

/**
 * Reads an image's size from the header of its base64 data, for the image
 * types prompts accept. Returns `undefined` when the header is truncated,
 * damaged, does not match `mimeType`, or records a zero dimension, so a
 * caller can treat the image as one it cannot show.
 */
export function imageSize(mimeType: string, data: string): ImageSize | undefined {
	const read = { 'image/png': pngSize, 'image/gif': gifSize, 'image/webp': webpSize, 'image/jpeg': jpegSize }[mimeType];
	const size = read?.(data);
	return size && size.width > 0 && size.height > 0 ? size : undefined;
}
