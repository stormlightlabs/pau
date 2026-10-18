import { themeCssProperties } from '../theme';

/** Defines the theme tokens on the page so tests can assert computed colors and borders. */
export function applyTheme(): void {
	const properties = Object.entries(themeCssProperties('eldritch', 'overpass'));
	for (const [name, value] of properties) document.documentElement.style.setProperty(name, value);
}
