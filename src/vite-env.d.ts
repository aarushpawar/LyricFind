/// <reference types="vite/client" />

interface LyricFindTestHarness {
  microphoneError?: 'NotAllowedError'
  sampleMs?: number
  signatureUri?: string
  devices?: Array<{ deviceId: string; label: string }>
}

interface Window {
  __LYRICFIND_TEST__?: LyricFindTestHarness
}
