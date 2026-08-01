/** Converts OS device identifiers into labels meant for people while leaving genuine monitor
 * names (for example, "Built-in Retina Display") untouched. The raw identifier remains the
 * persistence key; this is display-only so existing role assignments continue to match. */
export function friendlyDisplayName(name: string | null | undefined, index: number): string {
  const trimmed = name?.trim()
  if (!trimmed) return `Display ${index + 1}`

  // Windows commonly reports \\.\DISPLAY1 (and occasionally \\?\DISPLAY1) rather than a
  // manufacturer/model name. Some APIs omit the device-path prefix and return DISPLAY1.
  const windowsDeviceName = trimmed.match(/^\\\\[.?]\\DISPLAY\s*(\d+)$/i)
  const shortWindowsName = trimmed.match(/^DISPLAY\s*(\d+)$/i)
  const displayNumber = windowsDeviceName?.[1] ?? shortWindowsName?.[1]
  return displayNumber ? `Display ${Number(displayNumber)}` : trimmed
}
