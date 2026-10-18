const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const units = [
	['year', 31_536_000],
	['month', 2_592_000],
	['day', 86_400],
	['hour', 3600],
	['minute', 60]
] as const;

/** Formats a timestamp as "3 hours ago", or an empty string when it is missing or invalid. */
export function formatRelativeTime(timestamp: string | undefined, now: Date): string {
	const time = timestamp ? Date.parse(timestamp) : NaN;
	if (Number.isNaN(time)) return '';
	const seconds = Math.round((time - now.getTime()) / 1000);
	if (Math.abs(seconds) < 60) return 'just now';
	const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[4];
	return relativeTime.format(Math.trunc(seconds / size), unit);
}
