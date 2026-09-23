# Icon Sets

We want to use uno's icon plugin or unplugin here.

| Set          | Iconify prefix  | Style                                                                             | Used for in Pau                                                                                   | In the mockup now                                                |
| ------------ | --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Tabler       | `tabler:`       | Outline, 24px grid, even 2px stroke, ~5k icons, filled versions for active states | All interface icons: side bar, search, send, accept/reject, file tree, settings sections, toggles | ✅ Typed in by hand, so a few shapes may differ slightly         |
| Octicons     | `octicon:`      | GitHub's icons, 16px, filled                                                      | Git: branch, merge, commit, added/changed files; GitHub logo                                      | ✅ From an older copy installed here, so slightly older versions |
| Catppuccin   | `catppuccin:`   | Colourful file and folder icons in the Catppuccin palette                         | File tree, editor tabs, review file list                                                          | ⏳ Stand-in: Tabler file icons tinted by file type               |
| Simple Icons | `simple-icons:` | Single-colour brand logos, 3k+                                                    | MCP servers (Linear, Postgres, Playwright), agent logos                                           | ⏳ Stand-in: letter tiles                                        |

## Alternatives

| Set                                | Prefix                                   | When to pick it                                                           |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Lucide                             | `lucide:`                                | Softer and rounder than Tabler, with fewer icons                          |
| Carbon                             | `carbon:`                                | Squarer and more geometric, suits the flat look                           |
| Codicons                           | `codicon:`                               | VS Code's own icons, very editor-like, but thin for general interface use |
| vscode-icons / material-icon-theme | `vscode-icons:` / `material-icon-theme:` | File icons if Catppuccin doesn't fit a non-Catppuccin theme               |
| Pixelarticons                      | `pixelarticons:`                         | Optional retro touch for the status line or agent avatars                 |
