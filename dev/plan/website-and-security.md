# Website and deployment security

## Website and documentation

`apps/website` follows the SvelteKit documentation patterns used in Inkfinite,
Dalil, Stormbuffer, and Mire. It is a separate static site because `apps/web` is
an authenticated product surface rather than the public entry point. Its
canonical URL is `https://pau.stormlightlabs.org`, and it deploys as a static
site to Cloudflare Pages.

Use mdsvex content under `apps/website/src/content/docs`, validated
frontmatter, generated navigation and tables of contents, Shiki highlighting,
and Pagefind search. Prerender documentation pages and expose useful
machine-readable routes: raw Markdown for each page, `llms.txt`, `sitemap.xml`,
`robots.txt`, and Open Graph images. Keep the content layer small enough to
understand locally instead of adopting a general documentation framework.

Reuse presentational pieces from `packages/ui` when they fit the website,
including icons, buttons, theme tokens, code treatment, and small controls. Keep
the documentation shell, prose styles, search, navigation, SEO, and content
loaders in `apps/website`; these serve a reading surface and should not pull
agent state or dense application layout into the site.

Documentation changes belong to the same unit of work as the behavior they
describe. Document only working behavior. Each page should answer one task or
concept, start with the useful fact or instruction, include commands that can be
copied, and link to deeper detail instead of repeating it. The initial
information architecture covers installation, quickstart, Claude bridge,
desktop use, workspaces and sessions, built-in and external editors, terminal,
resources and MCP, server deployment, security, configuration reference,
resource monitoring, local sandboxing, architecture, and contributing.

The website build validates frontmatter, internal links, heading structure, code
examples that can be checked without credentials, raw Markdown routes, and
search indexing. Browser tests cover global navigation, documentation
navigation, search, copy controls, theme behavior, and narrow layouts.

## Web and desktop security

Desktop startup binds Axum to an ephemeral loopback port and supplies a random
bearer token to the webview. During desktop development, the same UI may run in
a normal browser against this local endpoint. This browser workflow is a
development aid, not the standalone web-server deliverable. Tokens must not be
written to normal logs.

The standalone web server ships after the desktop application. It serves the
built UI, owns process lifetime without Tauri, and defaults to loopback with a
tokenized URL. Remote access is a separate mode with an explicit listen address
and configured authentication. TLS should terminate in a documented reverse
proxy until the product has a reason to own certificates. The UI must state that
authenticated users can run commands with the server account's privileges.
