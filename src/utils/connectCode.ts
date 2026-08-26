/**
 * A short block of plain text that another already-connected device's Settings page ("Add Another
 * Device", LibrarySyncSection.vue) generates so a new device can join the same cloud library
 * without typing an app key by hand.
 *
 * The *code* is plain text, shown in a text field for copying with no camera involved. The *QR
 * image* built from it is not: LibrarySyncSection.vue wraps this code in a real https:// URL
 * (`?connectCode=…`) because encoding the plain text directly was tried on a real device and
 * failed — iOS's camera just offers "Search the web for …", with no copy affordance at all. A real
 * link is the one QR heuristic iOS handles reliably ("Open in Safari").
 *
 * In-app camera scanning would avoid the whole detour, but hits an unresolved WebKit bug in
 * installed-PWA mode where the video element never renders a frame (bugs.webkit.org #252465), so
 * the OS camera app plus copy/paste remains the only route that works.
 *
 * Where the scanned link lands differs by platform, which is why BootGate.vue branches on
 * `isStandalone` rather than auto-connecting: iOS cannot route a scanned link into an installed
 * PWA at all, so it opens a plain Safari tab whose storage partition the PWA will never see —
 * BootGate only re-displays the code there with a Copy button, for the operator to paste into the
 * PWA itself. Android's link capturing often opens the installed PWA directly, where there is no
 * separate-partition risk and the code is applied on the spot.
 */
const CONNECT_CODE_HEADER = 'WorshipStudioConnect/1'

export interface ConnectCode {
  provider: 'dropbox' | 'onedrive'
  clientId: string
  libraryFolderPath: string
}

export function buildConnectCode(code: ConnectCode): string {
  return [CONNECT_CODE_HEADER, code.provider, code.clientId, code.libraryFolderPath].join('\n')
}

/** Rejects anything that isn't actually one of this app's own connect codes — pasted/scanned text
 *  that's unrelated (a Remote Control pairing code, random text) fails clearly here rather than
 *  surfacing a confusing error deeper in the connect flow. */
export function parseConnectCode(text: string): ConnectCode | undefined {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.trim())
  if (lines[0] !== CONNECT_CODE_HEADER) return undefined
  const provider = lines[1]
  const clientId = lines[2] ?? ''
  if (provider !== 'dropbox' && provider !== 'onedrive') return undefined
  if (!clientId) return undefined
  return { provider, clientId, libraryFolderPath: lines[3] ?? '' }
}
