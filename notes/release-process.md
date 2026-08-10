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
   would be invisible to it; only `deploy-demo` declares one, for `actions/deploy-pages`,
   and needs none of these three):
   - `WINDOWS_CERTIFICATE` — the `.pfx` file, base64-encoded:
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes('scripts/release/worship-studio-codesign.pfx'))
     ```
   - `WINDOWS_CERTIFICATE_PASSWORD` — the password chosen in step 1.
   - `WINDOWS_CERT_THUMBPRINT` — the thumbprint printed in step 1.

3. **Enable GitHub Pages via Actions.** Repo Settings → Pages → Source → "GitHub Actions".
   One-time only; `release.yml`'s `deploy-demo` job handles every deploy after that.

4. Commit `scripts/release/worship-studio-codesign.cer` (from step 1) to the repo — churches
   need it present at that path for `install-trust-windows.ps1` to find.

Re-generating the certificate later (only if the key is lost or compromised) means every
already-trusted church machine needs to re-run `install-trust-windows.ps1` with the new
`.cer`, and all three secrets need updating.

## Cutting a release

1. Bump the version in `package.json` and `src-tauri/Cargo.toml` (keep both in sync).
   `src-tauri/tauri.conf.json`'s `version` field points at `../package.json` rather than
   carrying its own literal, so it follows automatically — confirmed by checking the generated
   Windows resource file's FileVersion/ProductVersion after a build.
2. Commit that change normally.
3. Tag and push:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. `release.yml` builds a signed Windows installer and republishes the GitHub Pages site (help
   site + demo, see "Static browser demo" below). macOS was dropped from the release matrix
   (no one currently runs live presentation from a Mac, and the web build already covers
   Mac-based prep work) — the Tauri config, signing rationale, and install instructions below
   are left in place in case that's revisited. The Windows build lands as a **draft** GitHub
   Release — review it and hit Publish when ready; the Pages site goes live immediately with no
   review step.

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

`release.yml`'s `deploy-demo` job builds two things and combines them into one artifact before
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
