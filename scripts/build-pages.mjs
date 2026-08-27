// Builds the combined static site: the VitePress help site at the root, and the real web/tablet
// app nested at /app/ underneath it — the same arrangement release.yml's deploy-pages job
// assembles for GitHub Pages, so the Cloudflare dev deployment differs from production only by
// origin. See notes/dev-workflow-plan.md.
//
// Exists so the hosting provider's build command is one line and the assembly is versioned here
// rather than typed into a dashboard nobody can review or diff.
//
// Base paths come from the environment because they differ per host: GitHub Pages serves this
// repo under /WorshipStudio/, while a Cloudflare Pages project serves it at the root. The
// defaults below are the root-served case; release.yml passes its own.
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const APP_BASE = process.env.VITE_BASE_PATH ?? '/app/'
const DOCS_BASE = process.env.VITEPRESS_BASE_PATH ?? '/'
const OUT_DIR = path.join(repoRoot, 'pages')

function run(script, env) {
  console.log(`\n> pnpm ${script}`)
  // execSync with a plain string rather than execFileSync + shell:true, which Node deprecates
  // (DEP0190) for concatenating unescaped args. A shell is needed either way to resolve pnpm's
  // .cmd shim on Windows — this runs there as well as on the Linux build container — and
  // `script` is a literal from this file, never input.
  execSync(`pnpm ${script}`, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

run('build', { VITE_BASE_PATH: APP_BASE })
run('docs:build', { VITEPRESS_BASE_PATH: DOCS_BASE })

// Rebuilt from scratch every time: a stale file from a previous run would otherwise be published
// alongside the current ones with nothing to reveal it.
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

// The help site's own build output — docs/.vitepress/config.ts points outDir here so the same
// files can be bundled into the Tauri app for offline help.
cpSync(path.join(repoRoot, 'src-tauri', 'resources', 'help'), OUT_DIR, { recursive: true })
cpSync(path.join(repoRoot, 'dist'), path.join(OUT_DIR, 'app'), { recursive: true })

console.log(`\nAssembled ${OUT_DIR} — help site at ${DOCS_BASE}, app at ${APP_BASE}`)
