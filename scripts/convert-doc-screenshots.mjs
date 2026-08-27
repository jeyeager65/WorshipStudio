// Converts the PNGs e2e/docs-screenshots/capture.js stages into lossless WebP files in
// docs/public/screenshots/, the VitePress docs' real, committed source — see that script's own
// doc comment for why lossless (not optimize-stock-backgrounds.mjs's quality:80) is right here:
// these are crisp UI/text screenshots, not photos. Run via `npm run capture:screenshots` (e2e/
// package.json chains this in automatically); rarely worth running standalone.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Resolved against this file's own location, not process.cwd() — unlike
// optimize-stock-backgrounds.mjs (always run from the repo root via a root package.json
// script), e2e/package.json's capture:screenshots chains straight to this file with
// `node ../scripts/convert-doc-screenshots.mjs`, which runs with cwd still set to e2e/.
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SOURCE_DIR = path.resolve(__dirname, '../e2e/docs-screenshots/.captured')
const OUTPUT_DIR = path.resolve(__dirname, '../docs/public/screenshots')

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })

  let files
  try {
    files = (await readdir(SOURCE_DIR)).filter((name) => name.endsWith('.png'))
  } catch {
    console.error(`No staged screenshots at ${SOURCE_DIR} — run "npm run capture:screenshots" from e2e/ first.`)
    process.exitCode = 1
    return
  }
  if (files.length === 0) {
    console.error(`${SOURCE_DIR} has no .png files to convert.`)
    process.exitCode = 1
    return
  }

  for (const file of files) {
    const sourcePath = path.join(SOURCE_DIR, file)
    const input = await readFile(sourcePath)
    // Captures from capture.js are always 1440x900 (its own setWindowSize), so this changes
    // nothing for them. It exists for hand-captured shots: a real presentation screen grabbed off
    // a 1920x1200 monitor arrived nearly twice the width of every other image on the page, for no
    // benefit at the ~700px the docs actually render them at.
    const resized = sharp(input).resize({ width: 1440, withoutEnlargement: true })
    // Lossless suits a UI screenshot — flat color regions, small crisp text — but not a
    // presentation slide, which is a photograph with display text over it. Lossless on those ran
    // 1.3MB where quality 90 lands at 190KB with the lettering still sharp, so the codec follows
    // the content: anything captured at the harness size is UI, anything larger is a slide.
    //
    // sharp's re-encode strips metadata by default (no withMetadata() call) — nothing beyond
    // pixels carries over into the committed file.
    const { width } = await sharp(input).metadata()
    const isPhotographic = (width ?? 0) > 1440
    const output = await (isPhotographic
      ? resized.webp({ quality: 90 })
      : resized.webp({ lossless: true })
    ).toBuffer()
    const filename = file.replace(/\.png$/, '.webp')
    await writeFile(path.join(OUTPUT_DIR, filename), output)
    console.log(
      `${file} -> ${filename}: ${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB`,
    )
    await rm(sourcePath)
  }
}

main()
