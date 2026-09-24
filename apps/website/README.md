# Pau website

The public documentation site is a statically generated SvelteKit application.
Documentation source files live in `src/content/docs`. Each file must provide a
title, description, and numeric navigation order in its frontmatter.

Run the site during development:

```sh
pnpm --filter @stormlightlabs/pau-website dev
```

Build the site and its Pagefind index from the repository root:

```sh
pnpm build:website
```

The static output is written to `apps/website/build` for deployment to
Cloudflare Pages.
