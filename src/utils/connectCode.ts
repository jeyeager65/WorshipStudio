/**
 * A short block of plain text (never a URL) that another already-connected device's Settings page
 * ("Add Another Device", LibrarySyncSection.vue) generates so a new device can join the same cloud
 * library without typing an app key by hand. Deliberately not a link: iOS has no way to route a
 * scanned link into an already-installed PWA (it always opens a plain Safari tab, with a
 * completely separate storage partition even if it could), and worse, in-app camera scanning of a
 * live video feed turned out to hit a real, unresolved WebKit bug in installed-PWA mode (video
 * never renders a frame — see bugs.webkit.org #252465). Plain, non-URL text sidesteps both: the
 * OS Camera app's QR reader offers a "Copy" affordance for text it doesn't recognize as a link
 * (no Safari detour), and copy/paste needs no camera API at all (no WebKit media bug to hit). The
 * operator scans with the ordinary OS camera app, copies the recognized text, and pastes it into
 * BootGate.vue's chooser screen.
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
