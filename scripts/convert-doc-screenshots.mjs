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
    // sharp's re-encode strips metadata by default (no withMetadata() call) — nothing beyond
    // pixels carries over into the committed file.
    const output = await sharp(input).webp({ lossless: true }).toBuffer()
    const filename = file.replace(/\.png$/, '.webp')
    await writeFile(path.join(OUTPUT_DIR, filename), output)
    console.log(
      `${file} -> ${filename}: ${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB`,
    )
    await rm(sourcePath)
  }
}

main()
