# Settings

Settings mirrors the app's own grouping. Most of it you set once during
[Getting Started](/getting-started) and never revisit — this page covers what each one does and,
where it matters, what changing it affects elsewhere.

![Settings page, showing the This Computer section](/screenshots/settings.webp)

## Application

- **This Computer** — a name for this machine, and a shortcut to re-run the
  [Getting Started](/getting-started) wizard. The name is how [Library Health](/library-health)
  labels who made a change when two devices edit the same record, so make it something you'd
  recognise in that list: "Booth PC", not "Desktop".
- **Library & Sync** — where the shared library lives, plus everything about keeping devices in
  step. See [Sync](/sync) for which arrangement suits which device. It holds several panels:
  - **Library folder** — the synced folder every device reads and writes.
  - **Local data folder** *(desktop only)* — see [below](#local-data-folder).
  - **Cloud connection** *(tablet, phone, Safari)* — signs in to Dropbox or OneDrive directly.
  - **Add Another Device** — your church's app ID, with a Copy button, for setting up a second
    tablet or phone. One ID serves the whole church. Creating it in the first place is a one-time
    job covered in [Cloud Setup](/cloud-setup).
  - **Sync health** — when this device last synced, what's waiting to upload, and a Sync Now
    button. Also where **Clear & Re-sync** lives, for when a device's local copy has gone wrong.
  - **Data tools** — Load Sample Data and Clear Existing Data. Both destructive, both mainly for
    trying things out; Clear Existing Data on a synced library deletes from every device.
- **About** — version, links to the source and issue tracker, and diagnostics: open the logs
  folder, or export a bundle to attach to a bug report. The bundle deliberately excludes your
  church's content, people and credentials.

## Appearance & Displays

- **Appearance** — dark mode for the operator interface. Doesn't affect what the congregation
  sees; that's [Presentation Themes](/themes).
- **Branding** — church name, logo and colours, used on [bulletins](/bulletin),
  [reports](/reports), and as the `brand-primary`/`brand-secondary` background options in themes.
- **Display Setup** — see [below](#display-setup).
- **Text Sizing** — see [below](#text-sizing).
- **External Apps** *(Windows only)* — profiles for handing off to another program mid-service,
  such as a video player, including the keys Worship Studio sends it. See
  [Presenting](/presenting).
- **Remote Control** *(desktop only)* — this computer's pairing details and the list of paired
  devices. Pairing itself starts from a person's editor — see [People](/people).

## Content Library

- **Song Collections** — the songbooks available on [song](/songs) records, and what supplies the
  citation on a song's presentation footer.
- **Bible Translations** — see [below](#bible-translations).
- **Canva** *(desktop only)* — connects this computer to a Canva account for use in the
  [Slide Library](/slides). Per computer, not shared.

## Service Planning

- **Service Types** — the list offered when creating a [service](/services) or setting a
  [template](/service-templates)'s defaults. Editing one renames it everywhere it's already used.

---

## Text Sizing

Minimum and maximum sizes for scripture and song text, plus fixed sizes for the header and footer
labels and the reference-only scripture display.

The maximum is the obvious one: how large text gets when there's room. **The minimum does more
than it looks.** It decides how much scripture fits on a slide — pagination splits a passage into
pages that each fit at the minimum size, so a smaller minimum packs more verses onto each slide
and a larger one splits sooner. See [Scripture](/scripture).

So set the minimum by what's readable from the back of your room, and let the splitting follow.
Setting it small to avoid extra slides produces slides nobody at the back can read.

## Display Setup

Which connected monitor is the **Control Screen** (what the operator sees) and which is the
**Audience Display**. **Identify** flashes a screen so you can tell which is which without
guessing — worth using rather than assuming, since monitor order rarely matches how they're
arranged on the platform.

Presenting from the desktop app needs a second display; with only one connected it stays
unavailable. The browser build works differently — it opens the audience output as its own window
and you send it fullscreen to whichever monitor you choose. See [Presenting](/presenting).

## Bible Translations

KJV is bundled and always works — no key, no account, no internet. ESV and api.bible editions
(NIV among others) each need a free API key from that provider.

**Keys are stored in the library, not on this computer**, so entering one shares it with every
device that syncs. Add it once and your tablet has it too.

Whichever translation you set as the default is pre-filled on new scripture items; any item can
override it.

## Local data folder

*Desktop only.* Where this computer keeps what belongs to **it** rather than to the church:
display roles, paired remote devices, the Canva sign-in, and any media marked Local-only. Left
blank it uses Worship Studio's own app-data folder, which is fine for most installs.

Worship Studio never syncs this folder itself. That doesn't stop *you* — on Windows you can point
it inside a OneDrive or Dropbox folder if you'd like it backed up, and that works fine. The one
thing to avoid is **two computers sharing the same one**: these are per-machine settings, so
pointing both at one folder would have each overwriting the other's display roles and paired
devices.

::: tip If you do back it up
Local-only media lives here, and video especially can be large. Not a problem in itself — just
worth knowing before you point it at a synced folder and wonder what's uploading.
:::
