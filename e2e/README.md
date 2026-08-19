# E2E tests (native Tauri app)

WebdriverIO + `tauri-driver`, driving the real compiled desktop app (WebView2 on Windows) —
not the browser/mock adapter. Use this for anything that's genuinely native-only: real Tauri
commands, multi-window behavior (the presentation window), real file I/O. For frontend-only
logic against the mock adapter, the Playwright MCP flow used elsewhere in this project is
faster (no Rust rebuild needed) and still the better tool — this suite is a complement, not a
replacement.

## One-time setup

```sh
cargo install tauri-driver
cd e2e
npm install
```

`npm install` also applies a local patch to `@wdio/tauri-service` (see "Known issue" below) —
this happens automatically via the `postinstall` script.

## Running

```sh
# Build the debug binary the tests point at (only needed after app code changes)
npm run build:app

# Run the suite
npm test
```

## Regenerating docs screenshots

```sh
npm run build:app        # only needed after app code changes
npm run capture:screenshots
```

Drives the real app through each documented screen and saves stills into `../docs/public/screenshots/`, referenced by the VitePress pages (`../docs/*.md`) — see `docs-screenshots/capture.js`'s own doc comment for how to add a new one. Deliberately a separate, manually-run command rather than part of `npm test` or CI: a screenshot needs a look before it lands (a UI change can shift layout in ways worth reviewing), and only needs regenerating when the screen it covers actually changed, not on every push. Review the diffed PNGs with `git diff` (or just open them) before committing.

`build:app` is intentionally a separate, manual step rather than an automatic pre-test hook —
this suite gets re-run often while iterating on a single test, and a full rebuild every time
is unnecessary overhead when the app itself hasn't changed since the last build.

## Known issue: patched `@wdio/tauri-service`

`@wdio/tauri-service` (as of 1.2.0) has a multi-window "auto-focus" mechanism that runs before
every `findElement`/`$`/`$$`/`getTitle` call. It calls Tauri commands
(`plugin:wdio|get_window_states`, etc.) that only exist when `tauri-plugin-wdio-webdriver` is
installed in the target app — i.e. only under `driverProvider: 'embedded'`. Under `'external'`
(the provider this project uses, matching `notes/architecture-plan.md`'s plain `tauri-driver`
choice, so no test-only plugin needs to ship in the app's own `Cargo.toml`), those commands
don't exist, and the resulting failure path hangs every `findElement`-family call after the
first, rather than failing fast — this took a long debugging session to actually pin down; the
symptom looked identical to a WebView2-specific rendering bug for a long time. See
`patches/@wdio+tauri-service+1.2.0.patch` for the fix (an early return when the session isn't
using the `'embedded'` provider). Re-check whether this is still needed on any
`@wdio/tauri-service` upgrade — the patch may become unnecessary, or need regenerating against
new line numbers, if upstream fixes this or changes the surrounding code.
