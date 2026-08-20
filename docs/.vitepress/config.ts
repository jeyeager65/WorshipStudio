import { defineConfig } from 'vitepress'

// This VitePress project is the design described in notes/help-system-plan.md: one build,
// shipped two ways — bundled into the Tauri app for offline in-app help (outDir below points
// straight at the Tauri resource dir the app opens at runtime, see src/adapters/tauri/index.ts's
// openHelp), and deployed to GitHub Pages as the project's public landing page (this same
// index.md's hero, see docs/index.md) with the web demo nested at /app/ underneath it — see
// release.yml's deploy-demo job. This config only covers the site itself.
export default defineConfig({
  title: 'Worship Studio Help',
  description: 'Help documentation for Worship Studio',
  // Only the GitHub Pages deploy sets this — a project repo's Pages site is served from
  // /<repo-name>/, not the domain root. Local dev, docs:preview, and the Tauri bundle (served
  // through the `help` URI scheme at a fixed root, see src-tauri/src/lib.rs) all leave this
  // unset and get '/'. Mirrors vite.config.ts's VITE_BASE_PATH for the same reason.
  base: process.env.VITEPRESS_BASE_PATH ?? '/',
  // cleanUrls (extensionless permalinks) needs a server that rewrites `/services` to
  // `services.html` — neither the Tauri in-app window (a custom URI scheme serving embedded
  // files by exact name, see src-tauri/src/lib.rs's `help` protocol) nor plain GitHub Pages
  // (no server-side rewrite rules) does that. Left off (VitePress's own default), every page
  // is addressed by its real `.html` filename everywhere, and — confirmed live — cleanUrls
  // being on made VitePress's own client-side router treat every direct `.html` load as an
  // unrecognized route and render its 404 page over the real content.
  outDir: '../src-tauri/resources/help',
  // `base` above is root-absolute (`/` or `/WorshipStudio/`), never relative (`./`) — a
  // relative base was tried first, to work around the generic Tauri asset protocol mangling
  // absolute paths (see the outDir comment above), but VitePress's client-side router *also*
  // uses `base` to strip the site's root prefix off `location.pathname` when matching a route,
  // and a relative value broke that (confirmed live: every direct page load rendered
  // VitePress's own 404 despite the real page — and its styling — loading fine). Both the
  // `help` URI scheme (fixed root `http://help.localhost/`) and GitHub Pages (fixed root
  // `/WorshipStudio/`) serve the whole site at one known, stable prefix, so a root-absolute
  // `base` resolves correctly in both.

  themeConfig: {
    nav: [{ text: 'Help Home', link: '/' }],

    // Grouped by workflow (what someone's trying to do) rather than mirroring the app's own
    // left-nav layout (which groups by "primary vs. design vs. utility" for icon real estate,
    // not by task) — a help site is browsed differently than an app sidebar is used.
    sidebar: [
      { text: 'Installation', link: '/installation' },
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Running a Service',
        items: [
          { text: 'Services', link: '/services' },
          { text: 'Assignments', link: '/assignments' },
          { text: 'Bulletin', link: '/bulletin' },
          { text: 'Announcements', link: '/announcements' },
        ],
      },
      {
        text: 'Your Library',
        items: [
          { text: 'Songs', link: '/songs' },
          { text: 'Slides', link: '/slides' },
          { text: 'Media', link: '/media' },
          { text: 'Presentation Themes', link: '/themes' },
          { text: 'Service Templates', link: '/service-templates' },
        ],
      },
      {
        text: 'People & Teams',
        items: [
          { text: 'People', link: '/people' },
          { text: 'Roles', link: '/roles' },
        ],
      },
      {
        text: 'Reports & Settings',
        items: [
          { text: 'Reports', link: '/reports' },
          { text: 'Sync', link: '/sync' },
          { text: 'Library Health', link: '/library-health' },
          { text: 'Settings', link: '/settings' },
        ],
      },
    ],
  },
})
