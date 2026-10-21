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

/** The type rule, for copy that explains why a file cannot attach. */
export const imageTypeRule = 'Only PNG, JPEG, GIF, and WebP images can be attached.';

/** Whether a file's MIME type is one the backend accepts. */
export function isImageType(type: string): boolean {
	return (imageTypes as readonly string[]).includes(type);
}

/**
 * What a file drag carries, judged before the drop. Browsers that hide the
 * file types until the drop, such as WebKit, give `unknown`.
 */
export type ImageDragKind = 'images' | 'mixed' | 'unsupported' | 'unknown';

/** Classifies the files in a drag from the MIME types its items expose. */
export function imageDragKind(transfer: DataTransfer | null): ImageDragKind {
	const types = [...(transfer?.items ?? [])].filter((item) => item.kind === 'file').map((item) => item.type);
	if (types.length === 0 || types.includes('')) return 'unknown';
	const supported = types.filter((type) => isImageType(type)).length;
	if (supported === types.length) return 'images';
	return supported === 0 ? 'unsupported' : 'mixed';
}

/**
 * Checks one file against the image limits. Returns operator-facing copy that
 * names the file, or `undefined` when the file can attach.
 *
 * @param attachedBytes Bytes already attached, counted against the request limit.
 */
export function imageRejection(file: File, attachedBytes: number): string | undefined {
	if (!isImageType(file.type)) {
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
