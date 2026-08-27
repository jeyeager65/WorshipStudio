# Presenting

Running the service live happens in the same [Service Workspace](/services) you planned it in —
there's no separate "presentation mode" to switch into and no export step. The order of worship
you built *is* the running order.

![Service Workspace, with a song's lyrics selected on the left and the live Presentation preview panel on the right](/screenshots/service-workspace.webp)

## Before you start

**Start Presenting** is in the workspace's top bar. Two things can stand in the way, and both
explain themselves:

- **The readiness check.** Anything that would break mid-service — an unresolved scripture
  reference, a missing media file, a role nobody is assigned to — is listed first, with a
  click-through to fix each one. You can present anyway; it's a warning, not a lock.
- **No audience display.** On the desktop app, presenting needs a second screen; if it can't find
  one it offers the display picker rather than failing silently. See
  [Settings → Display Setup](/settings) to set which monitor is which ahead of time, and
  **Identify** to flash a screen if you're not sure. In a browser the audience output is a second
  window instead, which you send fullscreen to whichever monitor you choose — and on a single-screen
  tablet it simply takes over the screen.

## The transport bar

Once you're live, the transport bar runs along the bottom of the workspace.

| Control | Key | What it does |
| --- | --- | --- |
| **Previous** | <kbd>←</kbd> | Back one slide |
| **Next** | <kbd>→</kbd> | Forward one slide |
| **Blank Screen** | <kbd>B</kbd> | Hides everything. Press again to restore exactly where you were |
| **Background Only** | <kbd>G</kbd> | Keeps the background, hides the words |

Previous and Next step through **every slide in the whole service** in order — verses, scripture
pages, announcement slides, media — not just the item you're looking at. Crossing from the last
slide of one item into the first of the next is automatic; you never have to "open" the next item.

**Blank Screen** and **Background Only** are overrides, not edits. Neither changes the service,
and both remember where you were.

::: tip Why two different "hide" buttons
**Blank Screen** is for when attention should leave the screen entirely — a prayer, a baptism,
anything where a bright wall is a distraction. **Background Only** keeps the room's visual mood
while clearing the words, which suits a musical interlude or the moments around communion.
:::

## Reading ahead while you present

The order of service list follows along on its own: as you move through the service, the item
being presented becomes the selected one, marked live so you can see at a glance where you are.

You can still click any other item to look at it — **that never changes what's on screen.** It's
there so you can work during a service: add a passage to the sermon while a song is up, check
what's coming, fix a typo three items ahead. The presentation stays exactly where you left it.

When you press Previous or Next again, the selection snaps back to whatever is live. So there's
no "getting lost" — moving the presentation is also how you get back to it.

## Previews

Three thumbnails show the **previous**, **current**, and **next** slide, rendered by the same code
that draws the real audience output. What you see there is what the congregation sees, at a
smaller size — including the auto-fitted text size and where lines wrap.

## Auto-advance

Slide presentations can step themselves along on a timer, which is what an announcement loop
before the service needs — see [Slides](/slides). Set the interval and whether it loops on the
presentation itself, or override it per service item.

Auto-advance deliberately **stops at the end of its own item** rather than rolling into whatever
comes next. Moving from one part of the service to the next stays a decision you make.

## Controlling it from elsewhere

**From a phone or tablet.** Pair a device under [Settings → Remote Control](/settings) and it
becomes a remote: **View Only** mirrors the presentation screen, and **Full Control** adds
Previous/Next and the ability to jump to any slide. Useful for a worship leader on the platform
who needs to see what's up without a sightline to the operator.

**From the audience window itself.** A phone or tablet with only one screen has nowhere to put an
operator view, so the slide *is* the control surface:

- **Tap the left third** — previous slide.
- **Tap the right third** — next slide.
- **Tap the middle** — a **Close** button appears in the bottom-left corner. It fades again after
  a few seconds.

Nothing is drawn over the slide the rest of the time, deliberately: with a tablet propped up in
front of the room, the congregation would otherwise be looking at a Close button all service. The
middle tap is how you get it back when you want it — the same reveal-then-fade behavior video
players use.

**Handing off to another app** *(Windows only)*. An External App item launches another program —
a video player, say — at that point in the service and can send it keystrokes. Set profiles up
under [Settings → External Apps](/settings).

## Other shortcuts

Beyond the transport keys above:

| Key | What it does |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Select the previous/next item in the order of service (without changing what's live) |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo |
| <kbd>F1</kbd> | Open this help |

On a Mac, use <kbd>Cmd</kbd> in place of <kbd>Ctrl</kbd>. Shortcuts stay out of the way while
you're typing in a text box.

::: tip Related
[Services](/services) covers building the order of worship in the first place;
[Presentation Themes](/themes) covers how the words and backgrounds look.
:::
