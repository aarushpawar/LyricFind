import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { AudioLines, ChevronDown, CircleAlert, Headphones, Mic, Pause, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react'
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

const MINIMUM_SAMPLE_MS = 8_000

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
    const snapshot = capture.snapshot()
    if (!snapshot || snapshot.sampleMs < MINIMUM_SAMPLE_MS) {
      // ponytail: progress is already shown by the status pill (`Listening · Ns`); no separate message.
      return
    }
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
      // the error after two consecutive failures so a lone blip stays silent.
      if (++failureCountRef.current < 2) return
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
    const interval = window.setInterval(() => {
      setBufferedMs(captureRef.current?.bufferedMs ?? 0)
      if (captureRef.current?.bufferedMs && captureRef.current.bufferedMs >= MINIMUM_SAMPLE_MS) void scan(false)
    }, 1_000)
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
  const statusText = !online ? 'Offline' : isRecognizing ? 'Recognizing…' : state.track ? 'Live & in sync' : bufferedMs < MINIMUM_SAMPLE_MS && isListening ? `Listening · ${Math.floor(bufferedMs / 1000)}s` : isListening ? 'Ready to recognize' : 'Not listening'

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
            <div className={`listen-orb ${isListening ? 'is-listening' : ''} ${isRecognizing ? 'is-scanning' : ''}`}>
              <div className="orb-ring ring-one" /><div className="orb-ring ring-two" />
              <div className="orb-core">{state.phase === 'denied' || state.phase === 'unsupported' ? <CircleAlert /> : isRecognizing ? <AudioLines /> : <Mic />}</div>
            </div>
            {state.phase === 'denied' ? <><p className="eyebrow">MICROPHONE BLOCKED</p><h1>Let the music in.</h1><p className="hero-copy">Allow microphone access in your browser’s site settings, then try again. LyricFind never uploads your raw audio.</p><button className="primary-button" onClick={() => void startListening()}><Mic /> Try microphone again</button></>
              : state.phase === 'unsupported' ? <><p className="eyebrow">BROWSER NOT SUPPORTED</p><h1>This browser can’t listen yet.</h1><p className="hero-copy">Use a current version of Chrome, Edge, Firefox, or Safari with Web Audio and WebAssembly enabled.</p></>
              : state.phase === 'requesting' ? <><p className="eyebrow">ONE QUICK THING</p><h1>Allow microphone access.</h1><p className="hero-copy">Your browser may be waiting for you to approve listening.</p><button className="primary-button" onClick={() => void startListening()}><Mic /> Start listening</button></>
              : state.phase === 'no-match' ? <><p className="eyebrow">STILL LISTENING</p><h1>Turn it up a little.</h1><p className="hero-copy">We couldn’t place that song yet. Keep the clearest part playing and scan again.</p><button className="primary-button" onClick={() => void scan(true)}><RefreshCw /> Scan again</button></>
              : <><p className="eyebrow">{isRecognizing ? 'MATCHING THE MOMENT' : isListening ? 'LIVE MUSIC DISCOVERY' : 'YOUR KARAOKE COMPANION'}</p><h1>{isRecognizing ? 'Finding your song…' : isListening ? 'Listening for music.' : 'Lyrics that keep up.'}</h1><p className="hero-copy">{isListening ? 'Play a song nearby. We’ll recognize it and bring every line in right on time.' : 'Hear a song. See the words. Sing along—live and in sync.'}</p>{!isListening && <button className="primary-button" onClick={() => void startListening()}><Mic /> Start listening</button>}</>}
            {state.message && <div className="state-message" role="status"><CircleAlert /> {state.message}</div>}
          </section>
        )}

        {state.track && (
          <section className="karaoke-view">
            <div className="track-card">
              <div className="cover-wrap">{state.track.artworkUrl ? <img src={state.track.artworkUrl} alt="" /> : <div className="cover-fallback"><Headphones /></div>}<span className="playing-bars"><i /><i /><i /></span></div>
              <div className="track-meta"><span className="now-playing">NOW PLAYING</span><h1>{state.track.title}</h1><p>{state.track.artist}{state.track.album ? ` · ${state.track.album}` : ''}</p></div>
              {state.stale && <div className="stale-badge"><WifiOff /> {state.message || 'Refreshing match…'}</div>}
            </div>
            <KaraokeLyrics lyrics={state.lyrics} activeIndex={activeIndex} />
          </section>
        )}
      </main>

      {isListening && <div className="controls-dock">
        <label className="device-picker"><Mic /><span><small>INPUT</small><select aria-label="Microphone" value={deviceId} onChange={(event) => { const value = event.target.value; setDeviceId(value); void startListening(value) }}>{devices.length ? devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>) : <option value="">Default microphone</option>}</select></span><ChevronDown /></label>
        <button className="icon-control" onClick={() => void stopListening()} aria-label="Stop listening"><Pause /></button>
        <button className="scan-button" disabled={isRecognizing} onClick={() => void scan(true)}><RefreshCw className={isRecognizing ? 'spin' : ''} />{isRecognizing ? 'Scanning' : 'Scan again'}</button>
      </div>}

      <footer><span><ShieldCheck /> Audio stays on this device. Only an anonymous fingerprint is sent for matching.</span><a href="https://lrclib.net" target="_blank" rel="noreferrer">Lyrics by LRCLIB</a></footer>
    </div>
  )
}
