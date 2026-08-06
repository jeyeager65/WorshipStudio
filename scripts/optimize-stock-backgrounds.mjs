// Converts the source stock background PNGs into optimized WebP files and places them in both
// locations the app needs them (Rust bundle resources for the desktop app, public/ for the web
// build's static asset serving) — these are two physically separate roots, so the same output
// gets written twice rather than shared via a build step, matching how few/rarely-changing files
// this is (see plans/snoopy-wishing-cocke.md for why).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE_DIR = 'C:\\Users\\jeyea\\Documents\\Worship Studio Import\\Backgrounds'
const OUTPUT_DIRS = [
  path.resolve('src-tauri/resources/stock-backgrounds'),
  path.resolve('public/stock-backgrounds'),
]

// Explicit filename -> slug map (not auto-slugified) so it stays the single source of truth the
// hand-written Rust/TS metadata (stock_content.rs / stockContent.ts) must match by hand.
const SOURCE_FILES = [
  { source: 'Golden Cross Over Misty Mountains.png', slug: 'golden-cross-over-misty-mountains' },
  { source: 'Golden Mist Over the Lake.png', slug: 'golden-mist-over-the-lake' },
  { source: 'Golden Sunrise Reading Vista.png', slug: 'golden-sunrise-reading-vista' },
  { source: 'Misty Lake at Dawn.png', slug: 'misty-lake-at-dawn' },
  { source: 'Misty Meadow at Sunrise.png', slug: 'misty-meadow-at-sunrise' },
  { source: 'Misty Woodland Creek.png', slug: 'misty-woodland-creek' },
]

async function main() {
  for (const dir of OUTPUT_DIRS) await mkdir(dir, { recursive: true })

  for (const { source, slug } of SOURCE_FILES) {
    const sourcePath = path.join(SOURCE_DIR, source)
    if (!existsSync(sourcePath)) {
      console.error(`Missing source file: ${sourcePath}`)
      process.exitCode = 1
      continue
    }
    const input = await readFile(sourcePath)
    // sharp's re-encode strips EXIF/metadata by default (no withMetadata() call) — no camera/GPS
    // data carries over into the committed files.
    const output = await sharp(input).webp({ quality: 80 }).toBuffer()
    const filename = `${slug}.webp`
    for (const dir of OUTPUT_DIRS) {
      await writeFile(path.join(dir, filename), output)
    }
    console.log(
      `${source} -> ${filename}: ${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB`,
    )
  }
}

main()
