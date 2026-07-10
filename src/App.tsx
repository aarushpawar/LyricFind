import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
  const lyricsCache = useRef(new Map<string, Lyrics>())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [bufferedMs, setBufferedMs] = useState(0)
  const [position, setPosition] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const autoAttemptedRef = useRef(false)

  useEffect(() => { stateRef.current = state }, [state])

  const refreshDevices = useCallback(async () => {
    const microphones = await AudioCapture.microphones().catch(() => [])
    setDevices(microphones)
    if (!deviceId && microphones[0]?.deviceId) setDeviceId(microphones[0].deviceId)
  }, [deviceId])

  const stopListening = useCallback(async () => {
    await captureRef.current?.stop()
    captureRef.current = undefined
    fingerprintRef.current?.terminate()
    fingerprintRef.current = undefined
    schedulerRef.current.finish()
    setBufferedMs(0)
    dispatch({ type: 'STOP' })
  }, [])

  const startListening = useCallback(async (selectedDevice = deviceId) => {
    if (!window.__LYRICFIND_TEST__ && (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.Worker || !window.WebAssembly)) {
      dispatch({ type: 'UNSUPPORTED' })
      return
    }
    dispatch({ type: 'REQUEST_PERMISSION' })
    try {
      const capture = new AudioCapture()
      await capture.start(selectedDevice || undefined)
      await captureRef.current?.stop()
      fingerprintRef.current?.terminate()
      captureRef.current = capture
      fingerprintRef.current = new FingerprintClient()
      schedulerRef.current = new ScanScheduler()
      dispatch({ type: 'LISTENING' })
      await refreshDevices()
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') dispatch({ type: 'DENIED' })
      else dispatch({ type: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Could not start the microphone.' })
    }
  }, [deviceId, refreshDevices])

  const lookupLyrics = useCallback(async (track: Track) => {
    const key = trackKey(track)
    const cached = lyricsCache.current.get(key)
    if (cached) {
      dispatch({ type: 'LYRICS', lyrics: cached })
      return
    }
    try {
      const lyrics = await fetchLyrics(track)
      lyricsCache.current.set(key, lyrics)
      if (stateRef.current.track && trackKey(stateRef.current.track) === key) dispatch({ type: 'LYRICS', lyrics })
    } catch {
      if (stateRef.current.track && trackKey(stateRef.current.track) === key) dispatch({ type: 'LYRICS', lyrics: { kind: 'missing' } })
    }
  }, [])

  const scan = useCallback(async (force = false) => {
    const capture = captureRef.current
    const fingerprinter = fingerprintRef.current
    if (!capture || !fingerprinter) return
    const snapshot = capture.snapshot()
    if (!snapshot || snapshot.sampleMs < MINIMUM_SAMPLE_MS) {
      if (force) dispatch({ type: 'NETWORK_ERROR', message: `Gathering sound… ${Math.floor((snapshot?.sampleMs ?? 0) / 1000)} of 8 seconds ready.` })
      return
    }
    if (!schedulerRef.current.tryStart(performance.now(), force)) return
    dispatch({ type: 'SCANNING' })
    try {
      if (!navigator.onLine) throw new Error('You’re offline. Lyrics will stay here while we reconnect.')
      const fingerprint = await fingerprinter.create(snapshot)
      const result = await recognize(fingerprint)
      if (result.status === 'no_match') {
        dispatch({ type: 'NO_MATCH' })
        return
      }
      const previousKey = stateRef.current.track ? trackKey(stateRef.current.track) : undefined
      const anchor = makePlaybackAnchor(result.matchOffsetSeconds, result.timeSkew, fingerprint.snapshotStartedAtMs)
      dispatch({ type: 'MATCH', track: result.track, anchor })
      if (previousKey !== trackKey(result.track) || !stateRef.current.lyrics) void lookupLyrics(result.track)
    } catch (error) {
      dispatch({ type: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Recognition is temporarily unavailable. Retrying…' })
    } finally {
      schedulerRef.current.finish()
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
    let frame = 0
    const tick = () => {
      const anchor = stateRef.current.anchor
      if (anchor) setPosition(playbackPosition(anchor, performance.now()))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

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
    void captureRef.current?.stop()
    fingerprintRef.current?.terminate()
  }, [])

  const activeIndex = useMemo(() => state.lyrics?.kind === 'synced' ? activeLyricIndex(state.lyrics.lines, position) : -1, [position, state.lyrics])
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
            {state.message && <div className="state-message">{state.message}</div>}
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
