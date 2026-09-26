const byteUnits = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Formats a byte count with one compact binary unit. */
export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return 'Unavailable';
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < byteUnits.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 }).format(value)} ${byteUnits[unit]}`;
}

/** Formats elapsed milliseconds without implying wall-clock precision. */
export function formatElapsed(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}m`;
	const remainder = seconds % 60;
	if (minutes > 0) return `${minutes}m ${remainder}s`;
	return `${remainder}s`;
}

/** Formats aggregate CPU use, which can exceed 100% for a process tree. */
export function formatCpu(percent: number): string {
	return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(percent)}%`;
}
