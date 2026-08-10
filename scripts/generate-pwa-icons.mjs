// Generates the icon set the tablet (PWA) build's manifest.webmanifest and index.html reference,
// from the same master icon `tauri icon` already generated for the desktop build
// (src-tauri/icons/icon.png) — one source, not a separate asset to keep in sync by hand.
//
// Every output composites the (light-colored) artwork onto a solid, opaque canvas — never left
// fully transparent behind the glyph itself. A transparent "any" icon looked fine on the desktop
// build (Windows supplies its own tile background behind it), but a PWA manifest icon has no such
// guarantee: depending on the OS/launcher it can render directly over the home screen wallpaper,
// so a light-colored glyph on transparency effectively disappears against a light wallpaper (and
// washes out against a dark one) — the bug that prompted this.
//
// Only the "any" icons additionally get transparent rounded corners baked in (a rounded-rect
// alpha mask via sharp's `dest-in` blend) — safe there because nothing else is guaranteed to mask
// them. "maskable" icons stay a full opaque square on purpose: they're the guaranteed fallback a
// platform without maskable support shows as-is, and the W3C spec's own safe-zone contract assumes
// zero transparency there. `apple-touch-icon` also stays a plain square: iOS always applies its
// own mask and explicitly flattens any transparency in this one to black, so hand-rounding it
// would just produce black corners once iOS gets through with it.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE = path.resolve('src-tauri/icons/icon.png')
const OUTPUT_DIR = path.resolve('public/pwa-icons')
const FAVICON_PATH = path.resolve('public/favicon.png')
const FAVICON_SIZE = 48
// Matches index.html's <style> background and SplashScreen.vue's .splash-bg. (Tried the brand
// primary blue #4C7FE8 first, but it sits too close to the blue gradient already inside the
// artwork's "screen" — the icon's own edge disappeared into the background at a glance.)
const BACKGROUND = '#151b23'

const ANY_SIZES = [192, 512]
const MASKABLE_SIZES = [192, 512]
// "any" gets more breathing room (no OS is guaranteed to crop it); "maskable" is guaranteed to be
// cropped toward a circle/squircle by some launchers, so its artwork stays inside a tighter safe
// zone.
const ANY_SAFE_ZONE_RATIO = 0.88
const MASKABLE_SAFE_ZONE_RATIO = 0.7
// Roughly matches the visual weight of iOS's own superellipse app-icon corner (a plain rounded
// rect is a close enough approximation for our purposes, not a true squircle).
const CORNER_RADIUS_RATIO = 0.14

async function iconOnBackground(source, canvasSize, artworkSize) {
  const artwork = await sharp(source).resize(artworkSize, artworkSize).toBuffer()
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: artwork, gravity: 'center' }])
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer()
}

/** Punches transparent rounded corners into an already-square icon buffer, via a rounded-rect
 *  alpha mask composited with sharp's `dest-in` blend (keep the base image only where the mask
 *  is opaque). */
async function withRoundedCorners(imageBuffer, size) {
  const radius = Math.round(size * CORNER_RADIUS_RATIO)
  const maskSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  )
  return sharp(imageBuffer)
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const source = await readFile(SOURCE)

  for (const size of ANY_SIZES) {
    const square = await iconOnBackground(source, size, Math.round(size * ANY_SAFE_ZONE_RATIO))
    const output = await withRoundedCorners(square, size)
    await writeFile(path.join(OUTPUT_DIR, `icon-${size}.png`), output)
    console.log(`icon-${size}.png (any, rounded)`)
  }

  for (const size of MASKABLE_SIZES) {
    const output = await iconOnBackground(source, size, Math.round(size * MASKABLE_SAFE_ZONE_RATIO))
    await writeFile(path.join(OUTPUT_DIR, `icon-maskable-${size}.png`), output)
    console.log(`icon-maskable-${size}.png (maskable)`)
  }

  const appleTouchIcon = await iconOnBackground(source, 180, Math.round(180 * ANY_SAFE_ZONE_RATIO))
  await writeFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'), appleTouchIcon)
  console.log('apple-touch-icon.png')

  // Same treatment as the "any" PWA icons (rounded corners) — a browser tab has no OS-level
  // masking either, so a favicon benefits from the same self-contained shape. PNG rather than
  // .ico: every evergreen browser supports it directly, and it avoids needing a separate ICO
  // encoder dependency just for this one file.
  const favicon = await withRoundedCorners(
    await iconOnBackground(source, FAVICON_SIZE, Math.round(FAVICON_SIZE * ANY_SAFE_ZONE_RATIO)),
    FAVICON_SIZE,
  )
  await writeFile(FAVICON_PATH, favicon)
  console.log('favicon.png')
}

main()
