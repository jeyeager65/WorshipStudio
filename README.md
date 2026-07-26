# Worship Studio

A church presentation/service-management app, built to replace [OpenSong](https://www.opensong.org/).
Tauri + Vue + Vuetify desktop app, no server — song/service/slide library data lives as plain
JSON files in a folder synced via Dropbox (or equivalent), not a database.

**Status:** the full v1 milestone roadmap is built — service planning, the song library, the
main live-presentation workspace, scripture lookup, a slide library, settings, an undo
mechanism, and this release pipeline. See [docs/architecture-plan.md](docs/architecture-plan.md)
for the milestone-by-milestone breakdown. Native (Tauri/Rust) backend support currently covers
songs, services, slides, and settings; a few adapter ports further out on the roadmap (displays,
live-session transport, media, remote control, sync status, email) are still mock-only — real
in the browser demo and in the UI, but not yet wired to native OS behavior. `src/adapters/types.ts`
is the authoritative list of what each port does.

- **Technical architecture & build plan**: [docs/architecture-plan.md](docs/architecture-plan.md)
- **Cutting a release / code-signing setup**: [docs/release-process.md](docs/release-process.md)

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

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server, mock adapter (browser, no Tauri) |
| `pnpm tauri dev` | Full desktop app against the real Rust backend |
| `pnpm build` | Type-checks, then builds `dist/` — the same output used by the Tauri bundle and the static demo |
| `pnpm preview` | Serves a built `dist/` locally |
| `pnpm type-check` | `vue-tsc`, no emit |
| `pnpm lint` | ESLint, auto-fixing |
| `pnpm format` | Prettier, writes `src/` |
| `pnpm test:unit` | Vitest — frontend unit tests |

Rust side (`src-tauri/`): `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
— all three run in CI (`.github/workflows/ci.yml`) alongside the frontend checks above.

## Project layout

```
src/                    Vue app — shared between the Tauri build and the static demo build
  adapters/             The UI/backend boundary
    types.ts            One interface every backend implements; the source of truth for what
                         each port (songs, services, slides, settings, displays, live, media,
                         remote, sync, email, ...) does and whether it's optional/feature-detected
    mock/                Browser/localStorage-backed implementation (demo + local dev)
    tauri/               Real desktop implementation, calling into src-tauri/ via invoke()
  models/                TypeScript types for the JSON data (songs, services, slides, settings)
  stores/                Pinia stores
  views/                 Screens (routed pages)
  components/            Shared/reusable components
  utils/                 Pure helper functions (scripture references, service flattening, ...)
  router/                vue-router routes + the unsaved-changes navigation guard
  plugins/               Vuetify setup (themes, icons)
src-tauri/               Rust backend
  src/commands/          Thin Tauri command wrappers (#[tauri::command])
  src/domain/            Pure logic the commands call into, unit-tested independent of Tauri
  src/models.rs          Rust-side mirror of the JSON data shapes (serde)
  src/paths.rs            Where the synced library folder lives on disk
  icons/                 App icons for every platform Tauri bundles for
docs/                    Architecture and release-process planning docs
scripts/release/         Windows code-signing certificate + one-time machine-trust script
.github/workflows/       CI (every push/PR) and Release (on a vX.Y.Z tag push)
```

## Releases

Tagged releases (`vX.Y.Z`) build a signed Windows installer and an unsigned macOS build, and
republish the static browser demo to GitHub Pages — see
[docs/release-process.md](docs/release-process.md) for the full one-time setup and the
steady-state release flow, including the one-time steps a church machine needs (trusting the
Windows certificate; the macOS Gatekeeper bypass).
