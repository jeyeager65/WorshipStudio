import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { LEAD_IN_SECONDS, BUFFER_SECONDS, PRE_ACTION_SECONDS } from './timing.mjs'

// Phase 3 of notes/help-system-plan.md's pipeline: overlay the pre-generated, pre-timed
// narration (+ captions) onto the continuous capture record.mjs produced. Offsets here must
// match record.mjs's own pacing exactly (a fixed lead-in before the first beat, a fixed
// human-click delay for beats reached by clicking something, then each beat's narration
// duration + buffer before the next one starts) — the audio/caption timeline is built to
// mirror the video's, not measured from it. Shared constants (timing.mjs) keep the two from
// drifting apart.

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const outDir = path.join(__dirname, 'out')
const narrationDir = path.join(outDir, 'narration')

const script = JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf-8'))
const timings = JSON.parse(fs.readFileSync(path.join(narrationDir, 'timings.json'), 'utf-8'))

function ffmpegSilence(seconds, destPath) {
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-t',
    String(seconds),
    '-c:a',
    'libmp3lame',
    destPath,
  ])
}

// --- SRT helpers: shift every cue in a single-track file by an offset, keep the text as-is ---
function parseSrtTime(text) {
  const [, h, m, s, ms] = /(\d+):(\d+):(\d+),(\d+)/.exec(text)
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms)
}
function formatSrtTime(ms) {
  const clamped = Math.max(0, Math.round(ms))
  const h = Math.floor(clamped / 3600000)
  const m = Math.floor((clamped % 3600000) / 60000)
  const s = Math.floor((clamped % 60000) / 1000)
  const rem = clamped % 1000
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rem, 3)}`
}
function shiftSrtCues(srtContent, offsetMs) {
  const blocks = srtContent.trim().split(/\r?\n\r?\n/).filter(Boolean)
  const cues = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    const timeLine = lines.find((line) => line.includes('-->'))
    if (!timeLine) continue
    const [startText, endText] = timeLine.split('-->').map((s) => s.trim())
    const textLines = lines.slice(lines.indexOf(timeLine) + 1)
    cues.push({
      startMs: parseSrtTime(startText) + offsetMs,
      endMs: parseSrtTime(endText) + offsetMs,
      text: textLines.join('\n'),
    })
  }
  return cues
}

// --- Build the audio segment list (lead-in, then narration+buffer per beat) and the shifted
// caption cues at the same time, since they share the exact same offset math. ---
const audioSegments = []
const tmpDir = path.join(outDir, 'tmp')
fs.mkdirSync(tmpDir, { recursive: true })

const leadInPath = path.join(tmpDir, 'lead-in.mp3')
ffmpegSilence(LEAD_IN_SECONDS, leadInPath)
audioSegments.push(leadInPath)

const bufferPath = path.join(tmpDir, 'buffer.mp3')
ffmpegSilence(BUFFER_SECONDS, bufferPath)

// One silence clip per distinct pre-action delay actually used (0 needs none) — cached by
// duration so repeats (e.g. two beats both preceded by a single normal click) reuse the file.
const preActionPaths = new Map()
function preActionSilencePath(seconds) {
  if (!seconds) return null
  if (!preActionPaths.has(seconds)) {
    const clipPath = path.join(tmpDir, `pre-action-${seconds}.mp3`)
    ffmpegSilence(seconds, clipPath)
    preActionPaths.set(seconds, clipPath)
  }
  return preActionPaths.get(seconds)
}

let cursorMs = LEAD_IN_SECONDS * 1000
const allCues = []

for (const { id } of script) {
  const beat = timings[id]
  if (!beat) throw new Error(`No timing for beat "${id}" — run generate-narration.mjs first.`)

  const preActionSeconds = PRE_ACTION_SECONDS[id] ?? 0
  const preActionPath = preActionSilencePath(preActionSeconds)
  if (preActionPath) {
    audioSegments.push(preActionPath)
    cursorMs += preActionSeconds * 1000
  }

  audioSegments.push(path.join(narrationDir, `${id}.mp3`))
  const srtContent = fs.readFileSync(path.join(narrationDir, `${id}.srt`), 'utf-8')
  allCues.push(...shiftSrtCues(srtContent, cursorMs))

  cursorMs += beat.durationSeconds * 1000
  audioSegments.push(bufferPath)
  cursorMs += BUFFER_SECONDS * 1000
}

// --- Write the final, renumbered subtitle track ---
const finalSrtPath = path.join(outDir, 'overview.srt')
const finalSrt = allCues
  .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}\n`)
  .join('\n')
fs.writeFileSync(finalSrtPath, finalSrt)
console.log(`Wrote captions to ${finalSrtPath}`)

// --- Mux: capture.mp4 is already high quality, standard-profile H.264 (see overview.record.js)
// — a straight stream copy keeps that quality with no transcode + concatenated/normalized
// audio + soft subtitles ---
const capturePath = path.join(outDir, 'capture.mp4')
if (!fs.existsSync(capturePath)) {
  throw new Error(`${capturePath} doesn't exist — run "node record.mjs" first.`)
}
const finalVideoPath = path.join(outDir, 'overview.mp4')

const inputArgs = [capturePath, ...audioSegments].flatMap((file) => ['-i', file])
const audioLabels = audioSegments.map((_, i) => `[${i + 1}:a]aformat=sample_rates=24000:channel_layouts=mono[a${i}]`)
const concatInputs = audioSegments.map((_, i) => `[a${i}]`).join('')
const filterComplex = `${audioLabels.join(';')};${concatInputs}concat=n=${audioSegments.length}:v=0:a=1[aout]`

execFileSync('ffmpeg', [
  '-y',
  ...inputArgs,
  '-i',
  finalSrtPath,
  '-filter_complex',
  filterComplex,
  '-map',
  '0:v',
  '-map',
  '[aout]',
  '-map',
  `${audioSegments.length + 1}:s`,
  '-c:v',
  'copy',
  '-c:a',
  'aac',
  '-c:s',
  'mov_text',
  '-shortest',
  finalVideoPath,
])

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`Wrote ${finalVideoPath}`)
