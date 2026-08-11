/**
 * Validates that scanned QR text is actually one of this app's own "Add Another Device" connect
 * links (LibrarySyncSection.vue's generator) before BootGate.vue acts on it — a QR code that's
 * unrelated (a Remote Control pairing code scanned by mistake, someone else's QR entirely) should
 * fail clearly here rather than surface a confusing error deeper in the connect flow, or worse,
 * silently misinterpret garbage as connect parameters.
 */
export function parseConnectLink(
  scannedText: string,
  expectedOrigin: string,
  expectedPathname: string,
): URLSearchParams | undefined {
  let url: URL
  try {
    url = new URL(scannedText)
  } catch {
    return undefined
  }
  if (url.origin !== expectedOrigin || url.pathname !== expectedPathname) return undefined
  if (!url.searchParams.has('connect')) return undefined
  return url.searchParams
}
