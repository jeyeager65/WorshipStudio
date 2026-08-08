import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// Phase 1 of the three-phase pipeline in notes/help-system-plan.md: generate narration audio
// first, measure its real duration, so record.mjs can pace the app to match — not the other
// way around. `edge-tts` is the project's only Python dependency, invoked here as a plain CLI
// subprocess (see that doc's "Open items for the video pipeline").

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const VOICE = 'en-US-AndrewNeural'
const outDir = path.join(__dirname, 'out', 'narration')

const script = JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf-8'))

fs.mkdirSync(outDir, { recursive: true })

const timings = {}

for (const { id, text } of script) {
  const mediaPath = path.join(outDir, `${id}.mp3`)
  const srtPath = path.join(outDir, `${id}.srt`)
  console.log(`Generating narration for "${id}"...`)
  execFileSync(
    'python',
    [
      '-m',
      'edge_tts',
      '--voice',
      VOICE,
      '--text',
      text,
      '--write-media',
      mediaPath,
      '--write-subtitles',
      srtPath,
    ],
    { stdio: 'inherit' },
  )

  const durationOutput = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    mediaPath,
  ]).toString('utf-8')
  const durationSeconds = Number.parseFloat(durationOutput.trim())
  if (!Number.isFinite(durationSeconds)) {
    throw new Error(`ffprobe couldn't read a duration for ${mediaPath} (got "${durationOutput}")`)
  }

  timings[id] = { text, durationSeconds }
}

fs.writeFileSync(path.join(outDir, 'timings.json'), JSON.stringify(timings, null, 2))
console.log(`Wrote timings for ${script.length} beats to ${path.join(outDir, 'timings.json')}`)
