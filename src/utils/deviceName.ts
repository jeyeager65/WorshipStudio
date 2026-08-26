/**
 * A starting name for a device that has no OS hostname to borrow.
 *
 * The desktop build never needs this — Rust defaults `this_computer_name` to `gethostname()`
 * (src-tauri/src/paths.rs). Browsers expose nothing equivalent, so the web/tablet adapter would
 * otherwise leave it blank and it would stay that way unless someone happened to open
 * Settings → General.
 *
 * That blank is not cosmetic: `thisComputerName` is the `updatedByDevice` stamp on every record
 * this device saves, and SyncConflictsView shows it when two devices disagree about the same song
 * or service. Tablets are the devices most likely to be *joining* an established library, so they
 * were the ones least likely to be identifiable in exactly the situation the field exists for.
 *
 * This is only ever a prefill. Two iPads would both suggest "iPad", which is barely better than
 * blank, so callers should put it in front of a human to confirm or replace.
 */

/**
 * @param maxTouchPoints `navigator.maxTouchPoints`. Required to tell an iPad from a Mac: since
 *   iPadOS 13 an iPad reports itself as "Macintosh" in the user-agent string and is distinguishable
 *   only by touch support. Without it, every iPad is named "Mac".
 */
export function suggestDeviceName(userAgent: string, maxTouchPoints = 0): string {
  const ua = userAgent.toLowerCase()
  const isMacLike = ua.includes('macintosh') || ua.includes('mac os')
  // Checked before the plain Mac case below, and before the `ipad` token, since a modern iPad
  // matches neither: it claims to be a Macintosh, and only the touch points give it away. Real
  // Macs report 0 here; a touch-capable one would be an iPad in all but name anyway.
  if (isMacLike && maxTouchPoints > 1) return 'iPad'
  if (ua.includes('ipad')) return 'iPad'
  if (ua.includes('iphone')) return 'iPhone'
  if (ua.includes('android')) return ua.includes('mobile') ? 'Android Phone' : 'Android Tablet'
  if (ua.includes('windows')) return 'Windows PC'
  if (isMacLike) return 'Mac'
  // After Android, whose user-agent also says Linux.
  if (ua.includes('linux') || ua.includes('cros')) return 'Linux PC'
  // Not "Tablet": this is the fallback for a browser nothing above recognised, which is as likely
  // to be a desktop as anything else, and a name that asserts the wrong form factor is worse than
  // one that asserts nothing.
  return 'Device'
}

/** The same suggestion for the current browser, so callers do not each have to remember that
 *  `maxTouchPoints` is the half that matters. */
export function suggestDeviceNameForThisBrowser(): string {
  if (typeof navigator === 'undefined') return 'Device'
  return suggestDeviceName(navigator.userAgent, navigator.maxTouchPoints)
}
