# Worship Studio

A church presentation/service management app, built to replace [OpenSong](https://www.opensong.org/).
Tauri + Vue + Vuetify desktop app, no server — library and service data live as plain JSON
files in a folder synced via Dropbox (or equivalent).

- **Feature spec & design sketches**: [design/](design/) — start with [design/README.md](design/README.md)
- **Technical architecture & build plan**: [docs/architecture-plan.md](docs/architecture-plan.md)
- **Cutting a release / code-signing setup**: [docs/release-process.md](docs/release-process.md)
- **Migration source**: [OpenSong/](OpenSong/) — the current church setup's data, used as the
  source for the OpenSong-import feature

## Stack

Vue 3 + TypeScript + Vuetify 4, Pinia, vue-router, Vite, Tauri v2 (Rust). See the architecture
doc for the full rationale, the adapter-based frontend/backend split, and the milestone plan.

## Requirements

- Node.js ≥ 24.11.1 (Vuetify 4's floor) — this repo pins `24.18.0` in CI
- pnpm (enable via `corepack enable && corepack prepare pnpm@11.17.0 --activate`, or install directly)
- Rust stable + Cargo, for the desktop shell (`src-tauri/`)

## Getting started

```sh
pnpm install

# Web-only, against the mock/fixture adapter (also the static demo build target)
pnpm dev

# Full desktop app, real Tauri backend
pnpm tauri dev
```

Other useful scripts: `pnpm lint`, `pnpm type-check`, `pnpm test:unit`, `pnpm build`.

## Project layout

```
src/            Vue app — shared between the Tauri build and the static demo build
  adapters/     The UI/backend boundary: one interface, a real (Tauri) and mock implementation
  models/       TypeScript types for the JSON data (songs, services, slides, media, settings)
  views/        Screens, named after the matching design sketch
  stores/       Pinia stores
src-tauri/      Rust backend — file I/O, display/window management, native integrations
design/         Feature spec and HTML mockups (source of truth for what to build)
docs/           Architecture and implementation planning docs
OpenSong/       Existing church data, for the migration/import path
```
