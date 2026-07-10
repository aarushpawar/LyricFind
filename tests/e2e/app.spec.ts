import { expect, test, type Page } from '@playwright/test'

const match = (id: string, title: string, offset = 0) => ({
  status: 'match',
  track: { id, title, artist: 'The Testers', album: 'Browser Sessions', isrc: `USAAA260000${id}` },
  matchOffsetSeconds: offset,
  timeSkew: 0,
})

async function installAudio(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript((values) => {
    window.__LYRICFIND_TEST__ = {
      sampleMs: 10_000,
      devices: [{ deviceId: 'test-mic', label: 'Studio microphone' }],
      ...values,
    }
  }, overrides)
}

async function mockServices(page: Page, recognition: object | (() => object), lyrics: object[]) {
  await page.route('https://recognition.test/recognize', async (route) => {
    await route.fulfill({ json: typeof recognition === 'function' ? recognition() : recognition })
  })
  await page.route('https://lrclib.net/api/search**', async (route) => route.fulfill({ json: lyrics }))
}

test('handles microphone permission denial and retry', async ({ page }) => {
  await installAudio(page, { microphoneError: 'NotAllowedError' })
  await page.goto('./')
  await expect(page.getByText('Let the music in.')).toBeVisible()
  await page.evaluate(() => { if (window.__LYRICFIND_TEST__) window.__LYRICFIND_TEST__.microphoneError = undefined })
  await page.getByRole('button', { name: 'Try microphone again' }).click()
  await expect(page.getByText('Listening for music.')).toBeVisible()
  await expect(page.getByLabel('Microphone')).toHaveValue('test-mic')
})

test('automatically recognizes and centers synchronized lyrics', async ({ page }) => {
  await installAudio(page)
  await mockServices(page, match('1', 'Right on Time'), [{
    id: 42, trackName: 'Right on Time', artistName: 'The Testers', albumName: 'Browser Sessions',
    instrumental: false, plainLyrics: 'First\nCurrent\nNext', syncedLyrics: '[00:00]First\n[00:05]Current\n[00:20]Next',
  }])
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Right on Time' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Current')).toHaveAttribute('aria-current', 'true')
  await expect(page).toHaveURL(/\/LyricFind\/$/)
})

test('manual scan changes songs without waiting for the automatic interval', async ({ page }) => {
  await installAudio(page)
  let calls = 0
  await mockServices(page, () => ++calls === 1 ? match('1', 'First Song') : match('2', 'Second Song'), [{
    id: 1, trackName: calls < 2 ? 'First Song' : 'Second Song', artistName: 'The Testers',
    albumName: 'Browser Sessions', instrumental: true,
  }])
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'First Song' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Scan again' }).click()
  await expect(page.getByRole('heading', { name: 'Second Song' })).toBeVisible()
})

test('shows plain lyrics with a clear unsynchronized notice', async ({ page }) => {
  await installAudio(page)
  await mockServices(page, match('3', 'Written Down'), [{
    id: 3, trackName: 'Written Down', artistName: 'The Testers', albumName: 'Browser Sessions',
    instrumental: false, syncedLyrics: null, plainLyrics: 'These words are plain\nBut they are still here',
  }])
  await page.goto('./')
  await expect(page.getByText('Unsynchronized lyrics')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/These words are plain/)).toBeVisible()
})

test('retains the current song offline and recovers on reconnect', async ({ page, context }) => {
  await installAudio(page)
  await mockServices(page, match('4', 'Never Lost'), [{
    id: 4, trackName: 'Never Lost', artistName: 'The Testers', albumName: 'Browser Sessions',
    instrumental: true,
  }])
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Never Lost' })).toBeVisible({ timeout: 10_000 })
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText('You’re offline. We’ll retry when you reconnect.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Never Lost' })).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Live & in sync')).toBeVisible()
})

test('stopping listening invalidates a recognition response already in flight', async ({ page }) => {
  await installAudio(page)
  await page.route('https://recognition.test/recognize', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await route.fulfill({ json: match('5', 'Too Late') }).catch(() => undefined)
  })
  await page.route('https://lrclib.net/api/search**', async (route) => route.fulfill({ json: [] }))
  await page.goto('./')
  await expect(page.getByText('Recognizing…')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Stop listening' }).click()
  await expect(page.getByRole('heading', { name: 'Lyrics that keep up.' })).toBeVisible()
  await page.waitForTimeout(1_200)
  await expect(page.getByRole('heading', { name: 'Too Late' })).not.toBeVisible()
  await expect(page.getByText('Not listening')).toBeVisible()
})
