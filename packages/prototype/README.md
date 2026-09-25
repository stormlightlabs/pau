# Pau prototype

This package is a static SvelteKit sandbox for Pau's product screens. It uses
fixed data and owns its design tokens, fonts, icons, components, and routes. It
does not import `apps/web` or `packages/ui`.

Use the prototype to settle layout, responsive behavior, states, and product
language before moving a design into the application. The fixtures are allowed
to explore ideas that the product does not implement yet; the specification and
technical plan remain the source of truth.

## Run it

```sh
pnpm --filter @stormlightlabs/pau-prototype dev
```

The index route links to every fixture. The persistent prototype menu also moves
between screens without returning to the index.

## Capture screenshots

Install Playwright's Chromium browser once if it is not already available:

```sh
pnpm --filter @stormlightlabs/pau-prototype exec playwright install chromium
```

Capture desktop screenshots:

```sh
pnpm --filter @stormlightlabs/pau-prototype screenshots
```

Capture desktop and mobile screenshots:

```sh
pnpm --filter @stormlightlabs/pau-prototype screenshots:all
```

The scripts build the static site, run it through Vite preview, and write PNGs
to `packages/prototype/screenshots/<project>/`. Generated screenshots and
Playwright reports are ignored by Git.

## Add a screen

1. Add a route under `src/routes/screens` or `src/routes/splash`.
2. Add it to the menu in `src/lib/components/PrototypeShell.svelte`.
3. Add it to the index route and `tests/screenshots.spec.ts`.
4. Keep shared colors, type, and spacing in `src/lib/design`.

Use real product terms and representative states. Do not invent capabilities,
customer data, or performance claims to fill a mockup.
