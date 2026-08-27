# Installation

::: tip Just want to look around first?
[Open the demo](https://jeyeager65.github.io/WorshipStudio/app/?demo=1) — the real app, running on
made-up sample data, with nothing to install and nothing to sign into. There's a full church
library in there: a year of past services, songs, a roster of people, announcements and themes, so
you can plan a service or run a presentation and see what it actually does.

Everything stays in that browser. No library is connected, nothing syncs anywhere, and you can
change or delete anything without consequence — a reset button restores the sample data whenever
you want. It's also a safe place to show a volunteer how something works without going near your
real library.
:::

Worship Studio runs three ways, all against the same synced library — pick whichever fits what
you're doing. **All three can plan a service and present it live**; they differ in what they can
reach outside the browser.

| | Best for | Install needed? |
| --- | --- | --- |
| **Windows desktop app** | The booth machine — remembers which monitor is the audience screen, pairs a phone remote, and is the only build that can hand off to an external app | Yes, one-time |
| **Web** | Planning and presenting from any laptop or desktop browser, with nothing to install | No |
| **Tablet (PWA)** | Planning, presenting, or reading along on an iPad or Android tablet | Optional (installable) |

## What works where

Almost everything works everywhere: the whole library, service planning, bulletins, reports,
rosters.

**Presenting works in the browser too, second monitor and all.** The audience output opens as its
own window with a fullscreen button in the corner: click it and, in Chrome or Edge, you get a list
of your monitors — pick the audience screen and it goes fullscreen there. From then on it's the
same slides and the same auto-fitted text the desktop app produces.

What the desktop app adds is memory. Its Display Setup assigns each monitor a role once, in
Settings, and every service after that lands on the right screen with nothing to click — plus
**Identify** to flash a screen when you can't tell them apart. In a browser it's a per-session
choice, because picking a screen has to be triggered by your click inside the audience window and
may ask permission the first time.

A phone or tablet with only one screen can present too, using the slide itself as the controls:
tap the left third for the previous slide, the right third for the next, and the middle to reveal
a **Close** button in the bottom-left corner (which fades again after a few seconds). See
[Presenting](/presenting).

Four things need the Windows desktop app, because each one reaches outside the browser:

| Desktop only | Why | Elsewhere |
| --- | --- | --- |
| **Display Setup** | Saving a monitor's role between sessions, and **Identify** to flash one, needs to enumerate displays from outside the browser | Pick the screen from the audience window's fullscreen button each session instead (Chrome/Edge) |
| **Remote Control** | The pairing server runs inside the app | — |
| **Launching external apps** | Starting another program and sending it keystrokes | Profiles are library data, so you can *edit* them anywhere — they just can't launch |
| **Canva** | Connects through the app rather than a hosted service | — |

None of these change your library, so a mixed setup is normal and expected: the booth computer
runs the desktop app, everyone else plans from a browser or tablet against the same synced
library.

## Windows desktop app

This is the one that actually runs live presentation — a second display, transport controls, the
readiness check, and everything else in the [Getting Started](/getting-started) guide.

1. Go to the [Releases page](https://github.com/jeyeager65/WorshipStudio/releases) and download
   the latest installer.
2. **First time only, on each machine:** Worship Studio installers are signed with a self-signed
   certificate rather than one from a paid certificate authority — a paid certificate isn't
   realistic for a free, open-source project distributed to a handful of church-owned machines.
   Windows doesn't trust a self-signed certificate by default, so without this step the installer
   shows an "unrecognized publisher" warning. This step fixes that permanently — every future
   release signed with the same certificate shows **Worship Studio** as the verified publisher
   from then on, with no need to repeat this step.

   This does *not* stop a separate, unrelated warning from Microsoft Defender SmartScreen (see
   step 3) — that one checks a file's reputation with Microsoft's own cloud service, which a
   self-signed certificate can never build up the way a paid one can, so it's expected on every
   new release regardless of this step.
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
3. Run the installer you downloaded in step 1. Expect two normal prompts:
   - **Microsoft Defender SmartScreen** ("Windows protected your PC") — this happens on
     *every* new release, even after step 2, because SmartScreen's reputation check is about
     the specific file, not whether you trust its signer. Click **More info**, then
     **Run anyway**.
   - A standard Windows installer elevation (UAC) prompt showing **Worship Studio** as the
     publisher — confirms step 2 worked.
4. Launch Worship Studio — the [setup wizard](/getting-started) walks you through the rest.

**Staying up to date:** once installed, the app checks for updates automatically on launch and
periodically while running, and prompts before installing anything — it never updates itself
without you tapping to confirm. Nothing further to do here.

## Web (no install)

Open [the app in a browser](https://jeyeager65.github.io/WorshipStudio/app/) — use **Chrome or
Edge**. Reading and writing your library folder directly uses the File System Access API, which
Firefox and Safari don't implement. The first time, choose **Open Your Library Folder** and pick
the same Dropbox/OneDrive-synced folder the desktop app uses. Your browser remembers that choice
for next time.

This works on **macOS** as well as Windows — Chrome and Edge are the same engine there as
anywhere else, so a Mac can use the folder route exactly like a Windows machine. Only Safari
can't.

It does assume this computer already runs the OneDrive or Dropbox desktop app and syncs that
folder. If it doesn't, you can skip installing one and connect to OneDrive or Dropbox through the
browser instead — the same route a tablet uses. That's often the lighter option on a laptop used
for planning, and it's the only option on Safari. It needs a one-time
[Cloud Setup](/cloud-setup) for your church.

Songs, slides, services, media, scripture lookup, rosters and reports all work here, and so does
presenting — output goes to a second browser window you move onto the audience screen, rather
than to a monitor the app drives itself. What you don't get is the desktop-only list above. This
is the option for volunteers doing prep work from a laptop that doesn't have (or doesn't need)
the desktop app installed.

## Tablet (iPad / Android)

The same web link above works on a tablet browser. **Install it before connecting anything** —
the first-run screen leads with the install step, and on an iPad it matters more than it looks:

- **iPad (Safari):** tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** tap the install prompt if one appears, or the browser menu → **Install
  app** / **Add to Home Screen**.

::: warning Install first, then connect
A page open in a Safari tab and the same page installed to the Home Screen get **separate
storage**. Connect in the tab and then install, and the installed app starts over knowing
nothing — you'd have to connect a second time. Installing first avoids that entirely.
:::

No tablet browser supports the desktop's File System Access API — on iPad every browser is
required to use WebKit underneath, whatever its name — so instead of picking a folder, a tablet
connects to your church's library over the Dropbox or OneDrive API and keeps its own synced local
copy. Once connected, it syncs automatically in the background.

That connection needs a one-time app registration on your church's cloud account, which produces
an **app ID** each device pastes in. It's a job for whoever administers the account, done once
for the whole church — see **[Cloud Setup](/cloud-setup)** before setting up your first tablet.

::: tip Where to go next
Once you've got the desktop app installed, continue with [Getting Started](/getting-started) for
the in-app setup wizard.
:::
