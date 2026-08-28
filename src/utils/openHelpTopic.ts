import { getAdapter } from '@/adapters'

/**
 * Opens the help site at one topic slug — the same slugs `router/index.ts` uses for
 * `meta.helpTopic`, optionally with an `#anchor`.
 *
 * Lifted out of App.vue so somewhere other than the app bar can link into the help. A settings
 * panel explaining a concept the help site covers in full is the case that prompted it: repeating
 * the instructions in a panel is hopeless, and leaving the reader to find the page themselves is
 * how a documented feature still reads as undocumented.
 *
 * The two builds reach it differently, which is the whole reason this isn't a one-liner at each
 * call site.
 */
export function openHelpTopic(topic: string): void {
  const [slug, anchor] = topic.split('#')
  if (getAdapter().kind === 'tauri') {
    // The desktop app bundles the built help site and opens it in its own window — no network,
    // and it works for a church with no internet in the building.
    getAdapter()
      .help.open?.(topic)
      .catch((error) => console.error('Failed to open help window:', error))
    return
  }
  // The browser build has no bundled help. On the real deploy the app is served one level under
  // the help site's own root (see release.yml's deploy-pages job), so a relative `../<topic>.html`
  // reaches it in a new tab; under a plain local `pnpm dev` there is no sibling help build and
  // this 404s — the same accepted gap as the help site's own "Try the Web Demo" link.
  window.open(`../${slug}.html${anchor ? `#${anchor}` : ''}`, '_blank', 'noopener')
}
