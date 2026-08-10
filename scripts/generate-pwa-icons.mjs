// Generates the icon set the tablet (PWA) build's manifest.webmanifest and index.html reference,
// from the same master icon `tauri icon` already generated for the desktop build
// (src-tauri/icons/icon.png) — one source, not a separate asset to keep in sync by hand.
//
// Three shapes, matching what a PWA manifest actually needs:
// - "any" icons: a plain resize, used as-is (browser applies its own mask/frame if it wants one).
// - "maskable" icons: OSes may crop these to a circle/rounded-square/squircle, so the artwork
//   needs to live inside the safe center ~80% — padded here onto a solid canvas in the app's own
//   background color (matches index.html's synchronous background, not white/transparent, so a
//   partially-visible padded edge never looks like a rendering bug).
// - apple-touch-icon: iOS ignores transparency (renders it as black), so this one is always
//   flattened onto the same background color rather than left transparent.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE = path.resolve('src-tauri/icons/icon.png')
const OUTPUT_DIR = path.resolve('public/pwa-icons')
// Matches index.html's <style> background and SplashScreen.vue's .splash-bg.
const BACKGROUND = '#151b23'

const ANY_SIZES = [192, 512]
const MASKABLE_SIZES = [192, 512]
const MASKABLE_SAFE_ZONE_RATIO = 0.7 // artwork covers ~70% of the canvas, centered

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const source = await readFile(SOURCE)

  for (const size of ANY_SIZES) {
    const output = await sharp(source).resize(size, size).png().toBuffer()
    await writeFile(path.join(OUTPUT_DIR, `icon-${size}.png`), output)
    console.log(`icon-${size}.png (any)`)
  }

  for (const size of MASKABLE_SIZES) {
    const artworkSize = Math.round(size * MASKABLE_SAFE_ZONE_RATIO)
    const artwork = await sharp(source).resize(artworkSize, artworkSize).toBuffer()
    const output = await sharp({
      create: { width: size, height: size, channels: 4, background: BACKGROUND },
    })
      .composite([{ input: artwork, gravity: 'center' }])
      .png()
      .toBuffer()
    await writeFile(path.join(OUTPUT_DIR, `icon-maskable-${size}.png`), output)
    console.log(`icon-maskable-${size}.png (maskable)`)
  }

  const appleTouchIcon = await sharp({
    create: { width: 180, height: 180, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: await sharp(source).resize(180, 180).toBuffer(), gravity: 'center' }])
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer()
  await writeFile(path.join(OUTPUT_DIR, 'apple-touch-icon.png'), appleTouchIcon)
  console.log('apple-touch-icon.png')
}

main()
