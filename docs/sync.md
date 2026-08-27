# Sync

Your library lives as plain files in a shared folder — Worship Studio itself never talks to
Dropbox or OneDrive directly except on tablets (see below). How that folder actually gets shared
between computers depends on which kind of device you're setting up.

## Desktop (Windows)

**Settings → Library & Sync → Library folder** points this computer at any folder on disk.
Worship Studio just reads and writes plain files there — it has no idea whether anything is
syncing that folder, and doesn't need to.

![Library folder panel in Settings](/screenshots/sync-settings.webp)

In practice, that means: install Dropbox or OneDrive's own desktop app first, let it finish
syncing a folder, then point Worship Studio's Library folder at that same folder. Every other
computer running its own Dropbox/OneDrive client with the same shared folder sees the same
library. **Worship Studio doesn't set this up for you** — it's your Dropbox/OneDrive account and
desktop app doing the actual file transfer underneath.

**Use Portable Folder** is a different, narrower option: it points Library folder at a `./Library`
folder next to the app itself, for running off a USB drive or a standalone install. This folder
is never synced by anything — see "Running without sync" below.

## Tablet

A tablet has no real folder access, so it connects directly to your church's Dropbox or OneDrive
account instead — **Settings → Library & Sync → Cloud connection**, an OAuth sign-in right in the
app.

::: warning OneDrive is the tested provider
The Dropbox side of this is implemented but has never been run against the live Dropbox API. If
you have the choice, use OneDrive on tablets for now. (Pointing a *desktop* at a Dropbox-synced
folder, as above, is unaffected — that path doesn't use Dropbox's API at all.)
:::

Before any of that works, your church needs a one-time app registration on the provider's side,
which produces an **app ID**. Every device needs that ID before it can talk to the provider's API
at all — see **[Cloud Setup](/cloud-setup)** for how to create one. It only has to be done once
for your whole church.

With the ID in hand, each device is the same short routine: open Worship Studio, choose your
provider, paste the ID, sign in, and pick the library folder from a list. Nothing else is typed by
hand. **Settings → Library & Sync → Add Another Device** shows your church's ID with a **Copy**
button so you can send it on — it isn't a secret (see [Cloud Setup](/cloud-setup) for why), so
emailing or texting it is fine.

Unlike desktop, there's no local-only fallback here — a tablet has nothing to read a library from
except that cloud connection, so it always needs one, working, to do anything at all.

## Web (browser)

The browser build can go either way at first launch: open a folder directly (the same idea as
desktop — works if that folder happens to be Dropbox/OneDrive-synced) or connect to
Dropbox/OneDrive the same way a tablet does. **Connect Dropbox or OneDrive Instead** in Settings
switches from one to the other later.

### Which one should you pick?

**Open a folder** if this computer already runs the OneDrive or Dropbox desktop app and syncs the
library folder. It's the shorter setup: no app registration, and the files are right there on
disk. It needs **Chrome or Edge** — the File System Access API it relies on isn't in Safari or
Firefox — but that's true on Windows, macOS and Linux alike. A Mac on Chrome opens a folder
exactly like a Windows machine does.

**Connect Dropbox or OneDrive** if it doesn't. Nothing says you have to install a sync client
just to use Worship Studio, and on a laptop used mainly for planning, signing in through the
browser is usually less work than setting one up and waiting for it to pull down a copy of
everything. The cost is the one-time [Cloud Setup](/cloud-setup) for your church — after which
each device is just a sign-in.

On an iPad or iPhone there's no decision to make: every browser there is required to use WebKit
underneath, so none can offer a folder picker whatever its name. Those always use the cloud
connection.

## Running without sync

Desktop can point Library folder at any plain folder that isn't synced by anything — a normal
local folder, or **Use Portable Folder** above. Everything works, but only on that one computer;
no other desktop and no tablet can ever see this library.

This is fine for a genuinely single-computer setup, but isn't recommended beyond that — it isn't
available at all for a tablet, and defeats the point the moment a second computer is involved.

**Back up regularly even then.** A lot of what protects you day to day — recovering an
accidentally deleted file, riding out a bad edit — actually comes from Dropbox or OneDrive's own
version history, not from Worship Studio. Without sync, none of that exists: the only safety net
left is the single rolling `.backup` copy the app keeps next to each file and
[Library Health](/library-health)'s damaged-file recovery, both a last resort rather than a real
backup. Copy your library folder somewhere else on a regular basis — this is worth doing even
*with* sync turned on, for anything you genuinely can't afford to lose.
