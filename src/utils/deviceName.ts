/**
 * A starting name for a device that has no OS hostname to borrow.
 *
 * The desktop build never needs this — Rust defaults `this_computer_name` to `gethostname()`
 * (src-tauri/src/paths.rs). Browsers expose nothing equivalent, so the web/tablet adapter has
 * always defaulted it to `''` (adapters/web/settings.ts) and left it that way unless someone
 * happened to open Settings → General.
 *
 * That blank is not cosmetic: `thisComputerName` is the `updatedByDevice` stamp on every record
 * this device saves, and SyncConflictsView shows it when two devices disagree about the same song
 * or service. Tablets are the devices most likely to be *joining* an established library, so they
 * were the ones least likely to be identifiable in exactly the situation the field exists for.
 *
 * This is only ever a prefill. Two iPads would both suggest "iPad", which is barely better than
 * blank, so callers should put it in front of a human to confirm or replace — and fall back to it
 * unedited only where there is no opportunity to ask (the scanned-QR path, which skips the form).
 */
export function suggestDeviceName(userAgent: string): string {
  const ua = userAgent.toLowerCase()
  // iPadOS 13+ reports itself as "Macintosh" and is distinguished only by touch support, which is
  // not visible from the string alone — so an iPad reaching here via that UA lands on "Tablet"
  // rather than being misreported as a Mac.
  if (ua.includes('ipad')) return 'iPad'
  if (ua.includes('iphone')) return 'iPhone'
  if (ua.includes('android')) return ua.includes('mobile') ? 'Android Phone' : 'Android Tablet'
  if (ua.includes('windows')) return 'Windows Device'
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac'
  return 'Tablet'
}
