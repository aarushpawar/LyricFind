import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ChevronDown, CircleAlert, Headphones, Mic, Pause, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react'
import { AudioCapture } from './audio/audio-capture'
import { FingerprintClient } from './audio/fingerprint-client'
import { KaraokeLyrics } from './components/KaraokeLyrics'
import { activeLyricIndex } from './lib/lrc'
import { fetchLyrics } from './lib/lrclib'
import { recognize } from './lib/recognition'
import { ScanScheduler } from './lib/scan-scheduler'
import { initialSessionState, sessionReducer } from './lib/session-state'
import { makePlaybackAnchor, playbackPosition } from './lib/timing'
import type { Lyrics, Track } from './types'
import './styles.css'

// Shazam often matches on ~3.5s; a shorter first buffer means faster time-to-lyrics.
// A miss retries quickly (see scan) with a longer sample, so an early failure is cheap.
// ponytail: bump back toward 5s if the first-attempt match rate is uselessly low.
const MINIMUM_SAMPLE_MS = 3_500
// Retry cadence: quick while hunting for a match, relaxed once locked on.
const SEARCHING_SCAN_INTERVAL_MS = 6_000
const MATCHED_SCAN_INTERVAL_MS = 12_000

function trackKey(track: Track): string {
  return track.isrc || `${track.id}:${track.title}:${track.artist}`
}

export default function App() {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState)
  const stateRef = useRef(state)
  const captureRef = useRef<AudioCapture | undefined>(undefined)
  const fingerprintRef = useRef<FingerprintClient | undefined>(undefined)
  const schedulerRef = useRef(new ScanScheduler())
  const scanEpochRef = useRef(0)
  const failureCountRef = useRef(0)
  const scanAbortRef = useRef<AbortController | undefined>(undefined)
  const lyricsAbortRef = useRef<AbortController | undefined>(undefined)
  const lyricsCache = useRef(new Map<string, Lyrics>())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [bufferedMs, setBufferedMs] = useState(0)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [online, setOnline] = useState(navigator.onLine)
  const autoAttemptedRef = useRef(false)

  useEffect(() => { stateRef.current = state }, [state])

  const refreshDevices = useCallback(async () => {
    const microphones = await AudioCapture.microphones().catch(() => [])
    setDevices(microphones)
    if (!deviceId && microphones[0]?.deviceId) setDeviceId(microphones[0].deviceId)
  }, [deviceId])

  const stopListening = useCallback(async () => {
    scanEpochRef.current += 1
    scanAbortRef.current?.abort()
    scanAbortRef.current = undefined
    lyricsAbortRef.current?.abort()
    lyricsAbortRef.current = undefined
    fingerprintRef.current?.terminate()
    fingerprintRef.current = undefined
    const capture = captureRef.current
    captureRef.current = undefined
    schedulerRef.current.finish()
    setBufferedMs(0)
    setActiveIndex(-1)
    stateRef.current = initialSessionState
    dispatch({ type: 'STOP' })
    await capture?.stop()
  }, [])

  const startListening = useCallback(async (selectedDevice = deviceId) => {
    if (!window.__LYRICFIND_TEST__ && (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.Worker || !window.WebAssembly)) {
      dispatch({ type: 'UNSUPPORTED' })
      return
    }
    const existingCapture = captureRef.current
    const epoch = ++scanEpochRef.current
    scanAbortRef.current?.abort()
    scanAbortRef.current = undefined
    lyricsAbortRef.current?.abort()
    lyricsAbortRef.current = undefined
    fingerprintRef.current?.terminate()
    fingerprintRef.current = undefined
    schedulerRef.current.finish()
    dispatch({ type: 'REQUEST_PERMISSION' })
    let pendingCapture: AudioCapture | undefined
    try {
      const capture = new AudioCapture()
      pendingCapture = capture
      await capture.start(selectedDevice || undefined)
      if (epoch !== scanEpochRef.current) {
        await capture.stop()
        return
      }
      const previousCapture = captureRef.current
      const fingerprinter = new FingerprintClient()
      captureRef.current = capture
      fingerprintRef.current = fingerprinter
      pendingCapture = undefined
      schedulerRef.current = new ScanScheduler()
      dispatch({ type: 'LISTENING' })
      await previousCapture?.stop()
      await refreshDevices()
    } catch (error) {
      await pendingCapture?.stop()
      if (epoch !== scanEpochRef.current) return
      if (existingCapture && captureRef.current === existingCapture) {
        try { fingerprintRef.current = new FingerprintClient() } catch { fingerprintRef.current = undefined }
        schedulerRef.current = new ScanScheduler()
        dispatch({
          type: 'NETWORK_ERROR',
          message: `Could not switch microphones. Continuing with the previous input. ${error instanceof Error ? error.message : ''}`.trim(),
        })
        return
      }
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') dispatch({ type: 'DENIED' })
      else dispatch({ type: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Could not start the microphone.' })
    }
  }, [deviceId, refreshDevices])

  const lookupLyrics = useCallback(async (track: Track, epoch: number) => {
    const key = trackKey(track)
    const cached = lyricsCache.current.get(key)
    if (cached) {
      if (epoch === scanEpochRef.current) dispatch({ type: 'LYRICS', lyrics: cached })
      return
    }
    lyricsAbortRef.current?.abort()
    const controller = new AbortController()
    lyricsAbortRef.current = controller
    try {
      const lyrics = await fetchLyrics(track, controller.signal)
      lyricsCache.current.set(key, lyrics)
      if (epoch === scanEpochRef.current && stateRef.current.track && trackKey(stateRef.current.track) === key) dispatch({ type: 'LYRICS', lyrics })
    } catch (error) {
      if (epoch === scanEpochRef.current && !controller.signal.aborted && stateRef.current.track && trackKey(stateRef.current.track) === key) dispatch({ type: 'LYRICS', lyrics: { kind: 'missing' } })
    } finally {
      if (lyricsAbortRef.current === controller) lyricsAbortRef.current = undefined
    }
  }, [])

  const scan = useCallback(async (force = false) => {
    const capture = captureRef.current
    const fingerprinter = fingerprintRef.current
    if (!capture || !fingerprinter) return
    // Once we have synced lyrics, don't burn a recognition (or the rate limit) until the
    // song is over. A forced scan (button press) always overrides. Without a known duration
    // we can't tell when it ends, so fall back to the normal scheduled cadence.
    const { lyrics, anchor } = stateRef.current
    if (!force && lyrics?.kind === 'synced' && lyrics.durationSeconds && anchor) {
      if (playbackPosition(anchor, performance.now()) < lyrics.durationSeconds) return
    }
    const snapshot = capture.snapshot()
    if (!snapshot || snapshot.sampleMs < MINIMUM_SAMPLE_MS) {
      // ponytail: progress is already shown by the status pill (`Listening · Ns`); no separate message.
      return
    }
    schedulerRef.current.minimumIntervalMs = stateRef.current.track ? MATCHED_SCAN_INTERVAL_MS : SEARCHING_SCAN_INTERVAL_MS
    if (!schedulerRef.current.tryStart(performance.now(), force)) return
    const epoch = scanEpochRef.current
    const controller = new AbortController()
    scanAbortRef.current = controller
    dispatch({ type: 'SCANNING' })
    try {
      if (!navigator.onLine) throw new Error('You’re offline. Lyrics will stay here while we reconnect.')
      const fingerprint = await fingerprinter.create(snapshot)
      if (epoch !== scanEpochRef.current || controller.signal.aborted) return
      const result = await recognize(fingerprint, controller.signal)
      if (epoch !== scanEpochRef.current || controller.signal.aborted) return
      if (result.status === 'no_match') {
        dispatch({ type: 'NO_MATCH' })
        return
      }
      const previousKey = stateRef.current.track ? trackKey(stateRef.current.track) : undefined
      const anchor = makePlaybackAnchor(result.matchOffsetSeconds, result.timeSkew, fingerprint.snapshotStartedAtMs)
      dispatch({ type: 'MATCH', track: result.track, anchor })
      if (previousKey !== trackKey(result.track) || !stateRef.current.lyrics) void lookupLyrics(result.track, epoch)
      failureCountRef.current = 0
    } catch (error) {
      if (epoch !== scanEpochRef.current || controller.signal.aborted) return
      // ponytail: one transient blip (Shazam 429 → 502) recovers next scan; only surface
      // the error after two consecutive failures so a lone blip stays silent. Still leave
      // the 'recognizing' phase, or the scan button stays disabled until the song ends.
      if (++failureCountRef.current < 2) {
        dispatch({ type: 'LISTENING' })
        return
      }
      dispatch({ type: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Recognition is temporarily unavailable. Retrying…' })
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = undefined
      if (epoch === scanEpochRef.current) schedulerRef.current.finish()
    }
  }, [lookupLyrics])

  useEffect(() => {
    if (autoAttemptedRef.current) return
    autoAttemptedRef.current = true
    void startListening()
  }, [startListening])

  useEffect(() => {
    // 250ms so a just-ready buffer isn't left waiting most of a second before the first scan.
    const interval = window.setInterval(() => {
      setBufferedMs(captureRef.current?.bufferedMs ?? 0)
      if (captureRef.current?.bufferedMs && captureRef.current.bufferedMs >= MINIMUM_SAMPLE_MS) void scan(false)
    }, 250)
    return () => window.clearInterval(interval)
  }, [scan])

  useEffect(() => {
    const anchor = state.anchor
    const lines = state.lyrics?.kind === 'synced' ? state.lyrics.lines : undefined
    if (!anchor || !lines) {
      setActiveIndex(-1)
      return
    }
    const updateActiveLine = () => {
      const position = playbackPosition(anchor, performance.now())
      const nextIndex = activeLyricIndex(lines, position)
      setActiveIndex((current) => current === nextIndex ? current : nextIndex)
    }
    updateActiveLine()
    const interval = window.setInterval(updateActiveLine, 200)
    return () => window.clearInterval(interval)
  }, [state.anchor, state.lyrics])

  useEffect(() => {
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible'
      schedulerRef.current.setVisible(visible)
      if (visible && captureRef.current?.bufferedMs && captureRef.current.bufferedMs >= MINIMUM_SAMPLE_MS) void scan(true)
    }
    const onOnline = () => { setOnline(true); if (captureRef.current) void scan(true) }
    const onOffline = () => { setOnline(false); dispatch({ type: 'NETWORK_ERROR', message: 'You’re offline. We’ll retry when you reconnect.' }) }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [scan])

  useEffect(() => () => {
    scanEpochRef.current += 1
    scanAbortRef.current?.abort()
    lyricsAbortRef.current?.abort()
    void captureRef.current?.stop()
    fingerprintRef.current?.terminate()
  }, [])

  const isListening = Boolean(captureRef.current)
  const isRecognizing = state.phase === 'recognizing'
  const statusText = !online ? 'Offline' : isRecognizing ? 'Matching…' : state.track ? 'In sync' : bufferedMs < MINIMUM_SAMPLE_MS && isListening ? `Listening · ${Math.floor(bufferedMs / 1000)}s` : isListening ? 'Listening' : 'Mic off'

  return (
    <div className={state.track ? 'app matched-app' : 'app'}>
      {state.track?.artworkUrl && <div className="ambient-art" style={{ backgroundImage: `url(${state.track.artworkUrl})` }} />}
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="LyricFind home"><span className="brand-mark"><i /><i /><i /><i /></span><span>LyricFind</span></a>
        <div className={`live-status ${isListening && online ? 'active' : ''}`}><span className="status-dot" />{statusText}</div>
      </header>

      <main>
        {!state.track && (
          <section className="hero-state">
            {state.phase === 'denied' || state.phase === 'unsupported'
              ? <div className="hero-alert"><CircleAlert /></div>
              : <div className={`listen-meter ${isListening ? 'is-listening' : ''} ${isRecognizing ? 'is-scanning' : ''}`}><i /><i /><i /><i /><i /></div>}
            {state.phase === 'denied' ? <><h1>Microphone access is blocked.</h1><p className="hero-copy">Allow the microphone in your browser’s site settings, then try again. Audio is fingerprinted on this device and never uploaded.</p><button className="primary-button" onClick={() => void startListening()}><Mic /> Try again</button></>
              : state.phase === 'unsupported' ? <><h1>This browser can’t run LyricFind.</h1><p className="hero-copy">It needs Web Audio, web workers, and WebAssembly. Current versions of Chrome, Edge, Firefox, and Safari all work.</p></>
              : state.phase === 'requesting' ? <><h1>Waiting on the microphone.</h1><p className="hero-copy">Your browser is asking for permission to listen.</p><button className="primary-button" onClick={() => void startListening()}><Mic /> Start listening</button></>
              : state.phase === 'no-match' ? <><h1>No match yet.</h1><p className="hero-copy">Get closer to the speaker or turn the music up, then scan again.</p><button className="primary-button" onClick={() => void scan(true)}><RefreshCw /> Scan again</button></>
              : <><h1>{isRecognizing ? 'Matching the song…' : isListening ? 'Listening for music.' : 'Lyrics for whatever’s playing.'}</h1><p className="hero-copy">{isRecognizing ? 'Comparing a few seconds of audio against the song catalog.' : isListening ? 'Play something near the microphone. The song and its lyrics appear once there’s a match.' : 'LyricFind names the song around you and scrolls the words in time. Audio never leaves this device.'}</p>{!isListening && <button className="primary-button" onClick={() => void startListening()}><Mic /> Start listening</button>}</>}
            {state.message && <div className="state-message" role="status"><CircleAlert /> {state.message}</div>}
          </section>
        )}

        {state.track && (
          <section className="karaoke-view">
            <div className="track-card">
              <div className="cover-wrap">{state.track.artworkUrl ? <img src={state.track.artworkUrl} alt="" /> : <div className="cover-fallback"><Headphones /></div>}<span className="playing-bars"><i /><i /><i /></span></div>
              <div className="track-meta"><h1>{state.track.title}</h1><p>{state.track.artist}{state.track.album ? ` · ${state.track.album}` : ''}</p></div>
              {state.stale && <div className="stale-badge"><WifiOff /> {state.message || 'Refreshing match…'}</div>}
            </div>
            <KaraokeLyrics lyrics={state.lyrics} activeIndex={activeIndex} />
          </section>
        )}
      </main>

      {isListening && <div className="controls-dock">
        <label className="device-picker"><Mic /><span><small>Input</small><select aria-label="Microphone" value={deviceId} onChange={(event) => { const value = event.target.value; setDeviceId(value); void startListening(value) }}>{devices.length ? devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>) : <option value="">Default microphone</option>}</select></span><ChevronDown /></label>
        <button className="icon-control" onClick={() => void stopListening()} aria-label="Stop listening"><Pause /></button>
        <button className="scan-button" disabled={isRecognizing} onClick={() => void scan(true)}><RefreshCw className={isRecognizing ? 'spin' : ''} />{isRecognizing ? 'Scanning' : 'Scan again'}</button>
      </div>}

      <footer><span><ShieldCheck /> Audio stays on this device. Only an anonymous fingerprint is sent for matching.</span><a href="https://lrclib.net" target="_blank" rel="noreferrer">Lyrics from LRCLIB</a></footer>
    </div>
  )
}
