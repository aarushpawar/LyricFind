// Records docs/demo.gif. Microphone, recognition Worker and LRCLIB are stubbed
// (same hooks as tests/e2e); no real audio or network is involved.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:4173/LyricFind/'
const tmp = 'test-results/demo-video'
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true })

const lrc = ['Walking down the avenue', 'Streetlights humming low', 'Every window glowing gold', 'Carry me along', 'Hold the note a little while', 'Let the chorus grow',
  'Nobody has to know the words', 'Just follow where it goes', 'Right on time, right on time', 'The whole room sings it back']
  .map((t, i) => `[00:${String(i * 2).padStart(2, '0')}.00]${t}`).join('\n')

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 900, height: 620 }, recordVideo: { dir: tmp, size: { width: 900, height: 620 } } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  window.__LYRICFIND_TEST__ = { sampleMs: 10_000, devices: [{ deviceId: 'm', label: 'Studio microphone' }] }
})
await page.route('https://recognition.test/recognize', (r) => r.fulfill({ json: {
  status: 'match', track: { id: '1', title: 'Right on Time', artist: 'The Testers', album: 'Browser Sessions', isrc: 'USAAA2600001' },
  matchOffsetSeconds: 0, timeSkew: 0 } }))
await page.route('https://lrclib.net/api/get**', (r) => r.fulfill({ status: 404, json: {} }))
await page.route('https://lrclib.net/api/search**', (r) => r.fulfill({ json: [{
  id: 42, trackName: 'Right on Time', artistName: 'The Testers', albumName: 'Browser Sessions', instrumental: false, plainLyrics: '', syncedLyrics: lrc }] }))
await page.goto(base)
await page.getByRole('heading', { name: 'Right on Time' }).waitFor({ timeout: 15_000 })
await page.waitForTimeout(9000)
await ctx.close(); await browser.close()

const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'))
execFileSync('ffmpeg', ['-y', '-i', `${tmp}/${webm}`, '-vf', 'fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', 'docs/demo.gif'], { stdio: 'inherit' })
