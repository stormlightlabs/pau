# Icon Sets

We want to use uno's icon plugin or unplugin here.

| Set          | Iconify prefix  | Style                                                                             | Used for in Pau                                                                                   | Shipped in `packages/ui`                     |
| ------------ | --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Tabler       | `tabler:`       | Outline, 24px grid, even 2px stroke, ~5k icons, filled versions for active states | All interface icons: side bar, search, send, accept/reject, file tree, settings sections, toggles | Interface icons through `Icon`               |
| Octicons     | `octicon:`      | GitHub's icons, 16px, filled                                                      | Git: branch, merge, commit, added/changed files; GitHub logo                                      | File tree Git state and status line branch   |
| Catppuccin   | `catppuccin:`   | Colourful file and folder icons in the Catppuccin palette                         | File tree, editor tabs, review file list                                                          | File tree only                               |
| Simple Icons | `simple-icons:` | Single-colour brand logos, 3k+                                                    | MCP servers and named services such as Linear, Postgres, and Playwright                           | A GitHub icon class that nothing renders yet |
| Logos        | `logos:`        | Product-specific color marks                                                      | Agent products whose mark differs from their parent company, including Claude Code                | Not installed                                |
| Pi press kit | Local SVG       | Official color vector from [`pi.dev/press-kit`](https://pi.dev/press-kit)         | Pi agent identity in session lists, status, and public examples                                   | Not yet                                      |

Use the product mark when it exists. Do not substitute a parent-company mark,
such as Anthropic, for the Claude product mark.

## Alternatives

| Set                                | Prefix                                   | When to pick it                                                           |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Lucide                             | `lucide:`                                | Softer and rounder than Tabler, with fewer icons                          |
| Carbon                             | `carbon:`                                | Squarer and more geometric, suits the flat look                           |
| Codicons                           | `codicon:`                               | VS Code's own icons, very editor-like, but thin for general interface use |
| vscode-icons / material-icon-theme | `vscode-icons:` / `material-icon-theme:` | File icons if Catppuccin doesn't fit a non-Catppuccin theme               |
| Pixelarticons                      | `pixelarticons:`                         | Optional retro touch for the status line or agent avatars                 |
