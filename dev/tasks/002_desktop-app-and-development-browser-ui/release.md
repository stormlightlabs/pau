# 2. Desktop app: Release

## Release surfaces

Website units apply the approved public-site direction from the `docs` page of
the `pau.fig` design file and its exports in `dev/prototype` to
`apps/website`. Keep available behavior distinct from planned work, and keep
the prototype's view switcher out of the public navigation. Review each website
unit at desktop and narrow widths in light and dark themes.

### 2.49 Website landing page

Status: planned
Blocked by: none

Build the landing page.

Verification:

- Build the website and review the landing page.

### 2.139 Documentation shell

Status: planned
Blocked by: none

Build the documentation reading shell with generated navigation and table of
contents.

Verification:

- Validate frontmatter, internal links, heading structure, raw Markdown routes,
  and copyable commands.
- Exercise global and documentation navigation, copy controls, and keyboard
  access.

### 2.140 Documentation search

Status: planned
Blocked by: 2.139

Add the Pagefind search UI.

Verification:

- Validate Pagefind indexing and exercise search with the keyboard.

### 2.141 Capability reference

Status: planned
Blocked by: 2.139

Build the capability reference.

Verification:

- Confirm available and planned capabilities are labelled distinctly.

### 2.142 Website theme controls

Status: planned
Blocked by: none

Add light, dark, and system theme controls.

Verification:

- Exercise theme persistence and the system theme.

### 2.143 Website interactive examples

Status: planned
Blocked by: 2.49

Add fixed interactive examples for sessions, file selection and diffs, and MCP
lifecycle states without connecting the public site to agent state.

Verification:

- Exercise each example with the keyboard and with reduced motion.

### 2.38 Website deployment

Status: planned
Blocked by: 2.140, 2.141, 2.142, 2.143

Deploy `apps/website` to Cloudflare Pages at `https://pau.stormlightlabs.org`
with preview deployments for pull requests.

Verification:

- Build and deploy from a clean checkout.
- Confirm the canonical URL, redirects, sitemap, search index, raw Markdown,
  `llms.txt`, and cache headers on the deployed site.

### 2.156 macOS dogfood build

Status: blocked
Status note: The release script and unsigned build work. Signing needs a
Developer ID Application certificate, which the development Mac lacks.
Blocked by: none

Build a signed and notarized Apple Silicon app from a release tag and install
it in `/Applications`.

Verification:

- Build, sign, notarize, and install a tagged release on the development Mac.
- Launch it and confirm Gatekeeper accepts it and the reported version matches
  the tag.
- Confirm a startup failure, such as a database from a newer version, shows its
  message in a native dialog instead of quitting silently.

### 2.39 AppImage packaging

Status: planned
Blocked by: 2.40, 2.45, 2.51

Package the first Linux desktop release as an AppImage. Leave `.deb`, RPM,
Intel macOS, signing, and notarization until release demand or available signing
infrastructure requires them.

Verification:

- Build the AppImage in the release environment.
- Launch it on the supported NixOS development machine and representative Ubuntu
  and Fedora environments.
- Complete the local backend, bundled frontend, CodeMirror, terminal, and
  preferred-editor launch smoke test.
