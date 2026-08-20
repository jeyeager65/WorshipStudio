# Installation

Worship Studio runs three ways, all against the same synced library — pick whichever fits what
you're doing.

| | Best for | Install needed? |
| --- | --- | --- |
| **Windows desktop app** | Running a live service, full presentation output | Yes, one-time |
| **Web** | Prep work from a laptop/desktop browser — songs, slides, services, media, rosters | No |
| **Tablet (PWA)** | Prep work or reference on an iPad/Android tablet | Optional (installable) |

## Windows desktop app

This is the one that actually runs live presentation — a second display, transport controls, the
readiness check, and everything else in the [Getting Started](/getting-started) guide.

1. Go to the [Releases page](https://github.com/jeyeager65/WorshipStudio/releases) and download
   the latest installer.
2. **First time only, on each machine:** Worship Studio installers are signed with a self-signed
   certificate rather than one from a paid certificate authority — a paid certificate isn't
   realistic for a free, open-source project distributed to a handful of church-owned machines.
   Windows doesn't trust a self-signed certificate by default, so without this step the installer
   shows an "unrecognized publisher" warning (you can still click through it — this step just
   makes that warning go away for good). This is genuinely one-time per machine — every future
   release signed with the same certificate installs cleanly after this, with no need to repeat it.
   - Download [`worship-studio-codesign.cer`](https://github.com/jeyeager65/WorshipStudio/raw/main/scripts/release/worship-studio-codesign.cer).
   - Double-click the downloaded file to open it, then click **Install Certificate...**
   - Choose **Local Machine** (not Current User) and click **Next** — this needs administrator
     rights, so Windows will prompt you to confirm.
   - Choose **Place all certificates in the following store**, click **Browse...**, select
     **Trusted Root Certification Authorities**, then **OK** → **Next** → **Finish**.
   - Windows will show one more warning asking you to confirm you want to install this root
     certificate — click **Yes**. That's expected for any self-signed certificate you're
     intentionally trusting.
   ::: details Prefer a terminal? (PowerShell alternative)
   Download both `install-trust-windows.ps1` and `worship-studio-codesign.cer` from the
   [`scripts/release` folder](https://github.com/jeyeager65/WorshipStudio/tree/main/scripts/release)
   into the same folder, open **PowerShell as Administrator** (search "PowerShell" in the Start
   menu, right-click → **Run as administrator**), then:
   ```powershell
   cd $HOME\Downloads
   powershell -ExecutionPolicy Bypass -File .\install-trust-windows.ps1
   ```
   Does exactly the same thing as the steps above, just scriptable.
   :::
3. Run the installer you downloaded in step 1. A standard Windows installer elevation (UAC)
   prompt showing "Worship Studio" as the publisher is normal.
4. Launch Worship Studio — the [setup wizard](/getting-started) walks you through the rest.

**Staying up to date:** once installed, the app checks for updates automatically on launch and
periodically while running, and prompts before installing anything — it never updates itself
without you tapping to confirm. Nothing further to do here.

## Web (no install)

Open [the app in a browser](https://jeyeager65.github.io/WorshipStudio/app/) — Chrome or Edge are
best supported (this uses the File System Access API to read/write your library folder directly,
which Firefox and Safari don't yet implement). The first time, choose **Open Your Library
Folder** and pick the same Dropbox/OneDrive-synced folder the desktop app uses. Your browser
remembers that choice for next time.

Everything except live presentation output works here: songs, slides, services, media, scripture
lookup, rosters, reports. This is the option for volunteers doing prep work from a laptop that
doesn't have (or doesn't need) the desktop app installed.

## Tablet (iPad / Android)

The same web link above works on a tablet browser, and can be installed like a regular app for a
more native feel:

- **iPad (Safari):** tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** tap the install prompt if one appears, or the browser menu → **Install
  app** / **Add to Home Screen**.

A tablet doesn't have the desktop's File System Access support, so instead of picking a folder
directly, it connects to your church's library over the Dropbox or OneDrive API and keeps its own
synced local copy — the first-run screen walks you through connecting one of those two providers.
Once connected, it syncs automatically in the background.

::: tip Where to go next
Once you've got the desktop app installed, continue with [Getting Started](/getting-started) for
the in-app setup wizard.
:::
