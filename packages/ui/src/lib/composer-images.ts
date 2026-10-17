/** Image types the backend accepts, in the order the file picker lists them. */
export const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** The most bytes one image may hold, matching the backend limit. */
export const maxImageBytes = 5 * 1024 * 1024;

/** The most bytes all images in one request may hold, matching the backend limit. */
export const maxRequestImageBytes = 10 * 1024 * 1024;

/** An image ready to send: the MIME type and base64 data without a `data:` prefix. */
export type PromptImage = { mimeType: string; data: string };

/** An image the operator attached to the composer. */
export type ComposerImage = {
	id: string;
	name: string;
	size: number;
	/** Object URL for the thumbnail. The owner revokes it when the image leaves the composer. */
	previewUrl: string;
	file: File;
};

/** Value for the file picker's `accept` attribute. */
export const imageAccept = imageTypes.join(',');

/**
 * Checks one file against the image limits. Returns operator-facing copy that
 * names the file, or `undefined` when the file can attach.
 *
 * @param attachedBytes Bytes already attached, counted against the request limit.
 */
export function imageRejection(file: File, attachedBytes: number): string | undefined {
	if (!(imageTypes as readonly string[]).includes(file.type)) {
		return `${file.name} is not a supported image. Attach a PNG, JPEG, GIF, or WebP file.`;
	}
	if (file.size > maxImageBytes) {
		return `${file.name} is larger than 5 MiB. Attach a smaller image.`;
	}
	if (attachedBytes + file.size > maxRequestImageBytes) {
		return `${file.name} would take the attached images over 10 MiB. Remove an image first.`;
	}
	return undefined;
}

/** Reads a file as base64 data without a `data:` prefix. */
export async function encodeImage(file: File): Promise<PromptImage> {
	let binary: string;
	try {
		binary = Array.from(new Uint8Array(await file.arrayBuffer()), (byte) => String.fromCodePoint(byte)).join('');
	} catch (cause) {
		throw new Error(`${file.name} could not be read.`, { cause });
	}
	return { mimeType: file.type, data: btoa(binary) };
}
