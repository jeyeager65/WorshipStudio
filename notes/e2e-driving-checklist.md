# Driving the e2e suite without losing an afternoon

A checklist for whenever an agent (or a person) needs to launch the real native app via `e2e/` —
running the suite, running one spec ad hoc, or capturing screenshots — rather than just editing
code. Everything below is procedural; none of it is an app bug. Each item has cost a full
debugging session at least once.

## 1. Always run `npm run build:app` first — after *frontend* changes too

```sh
cd e2e && npm run build:app
```

**This is the single most important item on the page.** `tauri.conf.json` sets
`frontendDist: "../dist"`, and `build:app`'s `beforeBuildCommand` runs `pnpm build` — so the
compiled e2e binary **bundles a snapshot of the frontend**. It does not read your working tree,
and it does not pick up the Vite dev server for its own UI. A `.vue`/`.ts`/CSS edit you made
five seconds ago is invisible to the app until you rebuild.

`e2e/README.md` says the build is "only needed after app code changes", which reads like it
means Rust changes. It doesn't — **frontend code is app code here.** Treat `build:app` as
mandatory before every verification run, and re-run it after every single change you then want
to see, no matter how small.

Two symptoms, both extremely misleading:

- **The app shows a stale version of your UI.** Your change appears simply not to work: the old
  layout, the old sizes, the old text. Everything about this looks like a CSS specificity
  problem, a scoped-style problem, or a caching problem. It is none of those. Do not go
  looking for WebView2 caches (`clear_stale_webview_cache` in `src-tauri/src/lib.rs`), do not
  clear `%LOCALAPPDATA%\dev.yeager.worshipstudio.e2e`, do not kill stray `msedgewebview2.exe`
  processes — all of that was tried, none of it was the cause. **Rebuild.**
- **`ERR_CONNECTION_REFUSED` on the app's very first navigation**, reproducible 100% of the
  time, failing in under 4 seconds with an identical screenshot each run. This means the binary
  is stale or was built without the e2e identifier (e.g. someone ran a plain `cargo build` or
  `tauri dev` against the same target dir since — including the user, in a terminal you can't
  see). It looks exactly like a dev-server networking fault and invites a long detour into
  `vite.config.ts`'s `server.host`, IPv4/IPv6 binding, and retry loops in the spec. **None of
  that is it. Rebuild.** Never edit `vite.config.ts` to chase this.

### `pnpm tauri dev` and `build:app` fight over the same binary

Both write `src-tauri/target/debug/worship-studio.exe`, but with different identifiers — so a
`pnpm tauri dev` run (the operator's normal way of using the app) silently replaces the e2e
binary with one pointing at the **real production library**. This is not hypothetical: it
happened mid-session, and `verifyE2eBinaryIdentifier()` in `onPrepare` is the only thing that
caught it. Without that guard the suite would have wiped and rewritten real data.

Two consequences:

- **Never bypass or weaken that identifier check.** It is the last line of defence between the
  test suite and a real library.
- **A running app locks the .exe.** `build:app` then fails with `failed to remove file ...
  Access is denied. (os error 5)`. The app has to be closed before rebuilding — which means
  asking the operator, since it's their window (see item 2).

**Don't verify a UI change by measuring pixels off a screenshot** — read the value out of the
running app, where it's unambiguous:

```js
const el = await $('.your-element')
console.log(await el.getSize(), (await el.getCSSProperty('font-size')).value)
```

If that prints your old values, the binary is stale. This turns "did my change land?" into a
one-line yes/no instead of a squint.

## 2. Port 5173 is exclusive and hardcoded — check it, ask before taking it

`build.devUrl` is `http://localhost:5173`, baked in at compile time. It cannot shift to another
port the way a plain `vite`/`pnpm dev` session can (that one auto-increments to 5174 when 5173
is busy — never a problem). `e2e/helpers/harness.js`'s `onPrepare` calls
`killProcessOnPort(5173)` unconditionally before spawning its own dev server; it can't tell a
disposable server from someone's live working session.

Before any e2e run (`npm test`, `npx wdio run wdio.conf.js --spec ...`,
`npm run capture:screenshots`, `npm run record:overview`):

```sh
netstat -ano | grep ':5173' | grep LISTENING   # Windows; lsof -i :5173 elsewhere
```

- Nothing listening -> proceed, no need to ask.
- Something listening -> **ask the user first.** It's almost certainly their own
  `pnpm tauri dev` session, and the harness will kill it silently. Don't assume it's yours to
  reclaim just because you started something on that port earlier.

**After the run**, `onComplete` frees the port — leave it free. **Don't start a dev server "to
restore" anything.** The operator runs the app with `pnpm tauri dev` (which starts its own Vite
on 5173) and will do that themselves when they want it; a stray `npm run dev` left behind just
occupies the port their next `tauri dev` needs. Report that the run is done and the port is
free.

(`build:app` sets `VITE_E2E_TEST_MODE` itself, so you never need to set it by hand.)

## 3. Ad hoc visual verification (throwaway, not permanent coverage)

1. Write a throwaway spec at `e2e/specs/zzz-verify-<feature>.spec.js`. Seed fixtures by writing
   JSON straight into `appDataDir/Library/<songs|people>/` (see `specs/add-song-order.spec.js`
   or `specs/remote-control.spec.js` for the shape) rather than driving creation forms through
   the UI — much faster, equally valid for a visual check.
2. `cd e2e && npx wdio run wdio.conf.js --spec specs/zzz-verify-<feature>.spec.js`
3. Save screenshots into `e2e/screenshots/` and actually `Read` them back — plus assert real
   values per item 1. A passing spec alone proves nothing about appearance.
4. Delete the spec and its screenshots afterward. `docs-screenshots/capture.js` is the real,
   maintained screenshot mechanism; a leftover one-off next to it is just clutter.

## 4. WebdriverIO selector gotcha

`$('.some-class button*=Label')` is invalid — the `*=` text-contains form can't be chained onto
a CSS selector in one string. Scope it in two steps instead:

```js
const scope = await $('.some-class')
const el = await scope.$('button*=Label')
```

(Same pattern already in `docs-screenshots/capture.js`: `serviceActions.$('button*=Plan')`.)

## 5. Genuine driver flakiness — worth exactly one retry

`tauri-driver`/`msedgedriver` session creation is intermittently flaky on this machine,
unrelated to app code. That looks like a session-creation/handshake failure — a *different*
shape from item 1's consistent, instant connection-refused-on-first-navigation. Retry once
before investigating. Don't spend a retry on the item 1 symptom; rebuild instead.
