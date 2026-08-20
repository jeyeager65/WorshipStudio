---
layout: home

# This same hero doubles as the project's public GitHub Pages landing page (root of the deploy,
# see release.yml's deploy-demo job) and the in-app help home page opened from the Tauri app's
# Help button/F1. The "Try the Web Demo" action below deliberately uses the full, absolute
# Pages URL rather than a relative /app/ link: a relative link resolves fine on Pages itself,
# but from inside the desktop app's bundled help:// site there is no /app/ to resolve against —
# confirmed live, it 404'd there. An absolute https:// URL works correctly from both places
# instead: same page on Pages, and a real (network-dependent) jump out to the live site from
# the in-app help window. `target: _self` keeps VitePress's client-side router from trying to
# intercept the click at all (see router.js's click handler: any <a> with a `target` attribute,
# any value, is left alone) — belt-and-suspenders, since the router already skips interception
# for a different-origin href on its own.
#
# The `?demo=1` param (BootGate.vue) skips straight to the mock/fixture adapter with no chooser —
# the bare /app/ URL (visited directly, not through this link) shows a real "Open Your Library
# Folder" / "Try the Demo" choice instead, since the web build is a real, usable app now, not
# just a pitch deck. This link keeps the one-click demo experience for anyone arriving here.
hero:
  name: Worship Studio
  text: Plan, prepare, and present your church services — all in one place.
  tagline: A guide to building your library, putting together a service, and running it live.
  # logo-dark.png is the variant meant for dark backgrounds (light-colored mark and wordmark —
  # see src/components/settings/AboutSection.vue's own logoDark/logoLight split for the same
  # convention elsewhere in the app), so it disappears against VitePress's light color mode.
  # This themeable {light, dark} form (not a plain src string) swaps automatically with
  # VitePress's own light/dark toggle.
  image:
    light: /logo-light.png
    dark: /logo-dark.png
    alt: Worship Studio
  actions:
    - theme: brand
      text: Installation
      link: /installation
    - theme: alt
      text: Try the Web Demo
      link: https://jeyeager65.github.io/WorshipStudio/app/?demo=1
      target: _self
    - theme: alt
      text: Browse all topics
      link: /services

features:
  - title: Services
    details: Build a week's order of worship from songs, slides, media, and announcements, then run it live from the same workspace.
    link: /services
  - title: Song & Slide Library
    details: Keep your songs and slides in one searchable library you build once and reuse every week.
    link: /songs
  - title: Media & Themes
    details: Import images and video, and style how lyrics and media look on the presentation display.
    link: /media
  - title: People & Roles
    details: Track who's serving each week and keep a reusable list of roles and role groups.
    link: /people
  - title: Reports
    details: Multi-week planning views and song-usage reporting, drawn straight from your services.
    link: /reports
  - title: Settings
    details: Library location and sync, display setup, external app hand-off, and general preferences.
    link: /settings
---
