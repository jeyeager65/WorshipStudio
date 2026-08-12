// Generates the icon set src-remote/public/manifest.webmanifest and src-remote/index.html
// reference, from the master icon at src-remote/icons/icon.png — same pattern as
// generate-pwa-icons.mjs for the main app, kept as a separate script/source because the Remote
// deliberately uses its own distinct icon (a wifi glyph in place of the main app's cross), not a
// recolor of the same artwork.
//
// The master source already has its own opaque background baked in, but NOT a perfectly flat
// one (a few RGB units of vignette/gradient noise across it, ~#161e26-#181f27) — so unlike a
// truly flat source, we can't just sample one of its pixels for the canvas fill. Instead this
// hard-codes the main app's own exact background (public/pwa-icons/icon-512.png's flat
// #151b23), so the two apps' icons sit on byte-for-byte the same color, matching what the user's
// Canva source was visually aiming for. The few-unit difference between that and the source
// art's own baked-in edge is imperceptible in practice.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE = path.resolve('src-remote/icons/icon.png')
const OUTPUT_DIR = path.resolve('src-remote/public/icons')

// Matches generate-pwa-icons.mjs's BACKGROUND exactly — see file comment above.
const BACKGROUND = '#151b23'

const ANY_SIZES = [192, 512]
const MASKABLE_SIZES = [192, 512]
// No OS is guaranteed to crop an "any"-purpose icon, so it gets more breathing room than a
// maskable one would; "maskable" is guaranteed to be cropped toward a circle/squircle by some
// launchers, so its artwork stays inside a tighter safe zone. Matches generate-pwa-icons.mjs's
// own ratios exactly.
const ANY_SAFE_ZONE_RATIO = 0.88
const MASKABLE_SAFE_ZONE_RATIO = 0.7
// Roughly matches the visual weight of iOS's own superellipse app-icon corner — same ratio the
// main app's icons use, so the two apps' icons read as a consistent family.
const CORNER_RADIUS_RATIO = 0.14

async function iconOnBackground(source, background, canvasSize, artworkSize) {
  const artwork = await sharp(source).resize(artworkSize, artworkSize).toBuffer()
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background },
  })
    .composite([{ input: artwork, gravity: 'center' }])
    .flatten({ background })
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
    const square = await iconOnBackground(
      source,
      BACKGROUND,
      size,
      Math.round(size * ANY_SAFE_ZONE_RATIO),
    )
    const output = await withRoundedCorners(square, size)
    await writeFile(path.join(OUTPUT_DIR, `icon-${size}.png`), output)
    console.log(`icon-${size}.png (any, rounded)`)
  }

  for (const size of MASKABLE_SIZES) {
    const output = await iconOnBackground(
      source,
      BACKGROUND,
      size,
      Math.round(size * MASKABLE_SAFE_ZONE_RATIO),
    )
    await writeFile(path.join(OUTPUT_DIR, `icon-maskable-${size}.png`), output)
    console.log(`icon-maskable-${size}.png (maskable)`)
  }
}

main()
