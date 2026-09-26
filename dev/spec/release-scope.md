# First-release scope

## First-release themes

Ship Eldritch, Nord, Iceberg, Catppuccin Mocha, and Vitesse Dark. A theme covers
the application shell, semantic states, syntax highlighting, terminal ANSI
colors, CodeMirror, and optional Neovim highlights. Applying an app theme to
Neovim requires explicit opt-in and must not silently load or replace the user's
Neovim configuration.

## Non-goals for the first release

- Cloud sandboxes or hosted execution
- Remote machine control before a separate transport and security design is
  complete
- Multiplayer editing
- Autonomous agent councils
- A visual workflow language
- Reimplementing Git, Neovim, Pi, or an LSP client in the frontend
- Normalizing every agent event into a false lowest-common-denominator model
