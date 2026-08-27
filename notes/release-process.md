# Release process

Covers M9 from [architecture-plan.md](architecture-plan.md): cutting a versioned release,
signing the Windows build, and republishing the GitHub Pages site (help site + demo — see
"Static browser demo" below and [help-system-plan.md](help-system-plan.md)). Read this once
before the first release — after the one-time setup below, cutting a release is just a version
bump and a tag push.

## Why self-signed (not a paid certificate)

This app runs on a handful of machines a single church owns and controls, synced over
Dropbox — it isn't distributed broadly to strangers. A paid code-signing certificate (from a
CA like DigiCert or SSL.com) exists to build publisher reputation with machines you don't
control; that's not the situation here, and it costs real money every year for no practical
benefit at this scale.

A self-signed certificate costs nothing, but Windows only trusts it on a machine where it's
been explicitly imported — so releases are signed with the same self-signed certificate every
time, and each church machine trusts that certificate once
(`scripts/release/install-trust-windows.ps1`). After that one-time step, every future signed
release just works, no warning.

macOS is left unsigned for the same reason, minus the trust-install step — Apple's
equivalent (Developer ID + notarization) requires a $99/year developer account, and there's
no self-signed substitute that satisfies Gatekeeper. If Mac machines become a bigger part of
this church's setup, revisit paying for it; for now, the one-time Gatekeeper bypass
(below) is the tradeoff.

## One-time setup (maintainer)

Do this once, not per-release.

1. **Generate the Windows code-signing certificate.** From a Windows machine with
   PowerShell:

   ```powershell
   ./scripts/release/generate-windows-cert.ps1 -PfxPassword (Read-Host -AsSecureString "PFX password")
   ```

   This prints a thumbprint and writes two files into `scripts/release/`:
   - `worship-studio-codesign.pfx` — private key + certificate. **Do not commit this.** Keep
     it somewhere secure (password manager attachment, etc.) — it's needed again only if the
     GitHub secret below is ever lost and needs re-uploading.
   - `worship-studio-codesign.cer` — public certificate only, no private key. **Commit this
     file** — `install-trust-windows.ps1` reads it directly from the repo.

2. **Store three *repository* secrets** (repo Settings → Secrets and variables → Actions →
   **Repository secrets** tab — not Environment secrets. The signing step runs in
   `build-tauri`, which doesn't declare an `environment:`, so an environment-scoped secret
   would be invisible to it; only `deploy-pages` declares one, for `actions/deploy-pages`,
   and needs none of these three):
   - `WINDOWS_CERTIFICATE` — the `.pfx` file, base64-encoded:
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes('scripts/release/worship-studio-codesign.pfx'))
     ```
   - `WINDOWS_CERTIFICATE_PASSWORD` — the password chosen in step 1.
   - `WINDOWS_CERT_THUMBPRINT` — the thumbprint printed in step 1.

3. **Enable GitHub Pages via Actions.** Repo Settings → Pages → Source → "GitHub Actions".
   One-time only; `release.yml`'s `deploy-pages` job handles every deploy after that.

4. Commit `scripts/release/worship-studio-codesign.cer` (from step 1) to the repo — churches
   need it present at that path for `install-trust-windows.ps1` to find.

Re-generating the certificate later (only if the key is lost or compromised) means every
already-trusted church machine needs to re-run `install-trust-windows.ps1` with the new
`.cer`, and all three secrets need updating.

## Auto-updater

A separate signing scheme from the Windows certificate above — that one proves who published
the installer (stops SmartScreen flagging it), this one proves an *update* actually came from
this project before the app installs it over itself. Set up once (August 2026):

1. **Generated the keypair** with `pnpm tauri signer generate -w <path>/tauri-updater.key`,
   non-interactively (`--ci -p <password>`) so it doesn't need a terminal prompt. Produces a
   private key file (password-protected) and prints the public key.
2. **The public key lives in `tauri.conf.json`**, `plugins.updater.pubkey` — not a secret,
   committed in the repo, since it's only ever used to *verify* a signature, not create one.
3. **Two more repository secrets**, same place as the three Windows ones:
   - `TAURI_SIGNING_PRIVATE_KEY` — the private key file's contents.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password.
4. **The private key file + password are backed up outside this repo** (Bitwarden) — losing
   both means every already-installed copy can still run, but no future release can ever be
   signed as an update for it again; every machine would need a fresh manual install instead.

`tauri.conf.json`'s `bundle.createUpdaterArtifacts: true` is what makes a release build also
produce a signed update bundle and a `latest.json` manifest; `tauri-apps/tauri-action@v0`
(`release.yml`) picks up the two secrets above automatically and uploads both alongside the
installer. The app checks `plugins.updater.endpoints` —
`https://github.com/jeyeager65/WorshipStudio/releases/latest/download/latest.json` — which is a
GitHub URL pattern that only ever resolves to the newest **published, non-draft** release.

**This means publishing now matters, not just reviewing.** A draft release (the default —
see "Cutting a release" below) is invisible to the updater; hitting Publish is what makes a
build available to already-installed machines, not just downloadable from the Releases page.

The in-app side (`src/stores/tauriUpdate.ts`, `src/composables/useTauriUpdate.ts`) checks on
launch and every 30 minutes while the window is visible, and only ever prompts — a banner
(`App.vue`) or the "Check for Updates" button (Settings → About) — never applies anything
without an explicit tap, since installing requires a full app restart. Checks (and the banner
itself) are suppressed entirely while presenting (`useLiveSessionStore().isPresenting`), so an
update can't so much as tempt a tap mid-service.

## Branches

Adopted 2026-08-27, replacing direct-to-main commits. See
[dev-workflow-plan.md](dev-workflow-plan.md) for the reasoning.

| Branch | Role |
| --- | --- |
| `main` | What churches are running. Protected: pull request required, `frontend` and `rust` CI must pass, no force pushes. Tags are cut here. |
| `dev` | Everyday work, committed to directly. A feature branch per change is ceremony with no second reviewer, so one is only worth cutting when a change is large or genuinely speculative. |
| `flyup/*` | An urgent fix that cannot wait for whatever is sitting in `dev`. |

`enforce_admins` is deliberately **off** on `main`: the protection is there to stop routine
mistakes, not to lock the maintainer out of their own repository mid-service. Use the flyup path
rather than the bypass whenever there is a choice.

**Flyup.** Branch from `main`, pull request into `main`, tag, release — then **merge `main` back
into `dev`**, or the fix is lost at the next release.

## Cutting a release

1. **Run the end-to-end suite** (not in CI — see below):
   ```sh
   cd e2e
   npm run build:app        # mandatory: the binary bundles the built frontend
   npm test
   ```
   CI covers unit tests, both builds, clippy and the Rust tests, but nothing exercises the real
   app, so this is the only thing that catches a spec drifting away from the UI it describes.
   That drift is silent and accumulates: by 2026-08-27 five specs were failing against changes
   made weeks earlier — a wizard that had gained a fork and a step, a tab renamed from "Plan
   Ahead" to "Plan", and a form field inserted above three inputs a spec addressed by index.
   Cutting a release is the natural checkpoint, being roughly the cadence a three-minute suite
   can absorb. If it ever moves into CI, pull requests into `main` are the place — the same
   moment, enforced.

2. On `dev`, bump the version in `package.json` and `src-tauri/Cargo.toml` (keep both in sync).
   `src-tauri/tauri.conf.json`'s `version` field points at `../package.json` rather than
   carrying its own literal, so it follows automatically — confirmed by checking the generated
   Windows resource file's FileVersion/ProductVersion after a build. The bump belongs to the
   release, not to the work: doing it here rather than earlier keeps `dev` from carrying a
   version it has not shipped.
3. Commit that change and push `dev`.
4. Open a pull request from `dev` into `main` and merge it once CI is green. Merge commit, not
   squash — the individual commits explain their own reasoning and are what the release notes
   are drawn from.
5. Tag `main` and push the tag:
   ```sh
   git checkout main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```
   A tag is a pointer to a commit, not part of a branch or a pull request, and it is never pushed
   by the commit push — which is why this is its own step, and why the tag push is what starts a
   release. `release.yml` refuses a tag whose commit is not yet an ancestor of `main`, so pushing
   one before the merge lands fails the run rather than publishing unreleased code. If that
   happens: merge, then `git push origin :refs/tags/v0.2.0` and push the tag again, since
   re-pushing an unchanged tag does not re-trigger anything.
6. `release.yml` builds a signed Windows installer and republishes the GitHub Pages site (help
   site + demo, see "Static browser demo" below). macOS was dropped from the release matrix
   (no one currently runs live presentation from a Mac, and the web build already covers
   Mac-based prep work) — the Tauri config, signing rationale, and install instructions below
   are left in place in case that's revisited. The Windows build lands as a **draft** GitHub
   Release — review it and hit Publish when ready; the Pages site goes live immediately with no
   review step. Publishing is also what makes it visible to the auto-updater (see that section
   above) — leave it draft for a build you don't want already-installed machines picking up yet.

## First install on a given machine

**Windows:** run `scripts/release/install-trust-windows.ps1` as Administrator, once per
machine (see the script's own comments for what it does and why). Every release after that
installs without a publisher warning. A standard installer elevation (UAC) prompt showing
"Worship Studio" as the publisher is still normal — trusting the certificate just stops it
from being flagged as unrecognized.

**macOS:** the app is unsigned, so Gatekeeper blocks it by default on first launch.
Right-click the app → **Open** → **Open** again in the confirmation dialog (this bypasses
Gatekeeper for that app going forward; a plain double-click will still refuse to launch it
the first time). This is only needed once per machine per app version.

## Static browser demo

`pnpm build` produces the same `dist/` output whether or not it's running inside Tauri — the
adapter layer (`src/adapters/index.ts`) picks the mock (browser/localStorage) backend
automatically when `window.__TAURI_INTERNALS__` isn't present. The Pages deploy builds that
same output with `VITE_BASE_PATH=/WorshipStudio/app/` (a project repo's Pages site is served
from `/<repo-name>/`, not the domain root, and the demo is nested one level further down, under
the help site that owns the root — see next section) — no separate demo-specific code path to
maintain.

## GitHub Pages site structure

`release.yml`'s `deploy-pages` job builds two things and combines them into one artifact before
`actions/upload-pages-artifact`/`actions/deploy-pages`, since Pages only takes one artifact per
deploy:

- **`/`** (the Pages root) — the VitePress help site (`docs/`, see
  [help-system-plan.md](help-system-plan.md)), doubling as the project's public landing page.
  Built with `VITEPRESS_BASE_PATH=/WorshipStudio/`.
- **`/app/`** — the static browser demo above, copied into the assembled artifact under an
  `app/` subfolder. Linked from the landing page's "Try the Web Demo" hero button
  (`docs/index.md`).

Both env vars default to `/` (root) when unset, which is what local dev, `docs:preview`, and
the Tauri bundle (served through its own `help://` URI scheme, unrelated to Pages) all use —
only this one CI job overrides them.
