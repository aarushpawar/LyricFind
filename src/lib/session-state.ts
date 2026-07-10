import type { Lyrics, PlaybackAnchor, Track } from '../types'

export type SessionPhase = 'onboarding' | 'requesting' | 'listening' | 'recognizing' | 'matched' | 'no-match' | 'denied' | 'unsupported'

export interface SessionState {
  phase: SessionPhase
  track?: Track
  lyrics?: Lyrics
  anchor?: PlaybackAnchor
  consecutiveNoMatches: number
  stale: boolean
  message?: string
}

export type SessionAction =
  | { type: 'REQUEST_PERMISSION' }
  | { type: 'LISTENING' }
  | { type: 'SCANNING' }
  | { type: 'MATCH'; track: Track; anchor: PlaybackAnchor }
  | { type: 'LYRICS'; lyrics: Lyrics }
  | { type: 'NO_MATCH' }
  | { type: 'NETWORK_ERROR'; message: string }
  | { type: 'DENIED' }
  | { type: 'UNSUPPORTED' }
  | { type: 'STOP' }

export const initialSessionState: SessionState = { phase: 'onboarding', consecutiveNoMatches: 0, stale: false }

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'REQUEST_PERMISSION': return { ...state, phase: 'requesting', message: undefined }
    case 'LISTENING': return { ...state, phase: state.track ? 'matched' : 'listening', message: undefined }
    case 'SCANNING': return { ...state, phase: 'recognizing', stale: false, message: undefined }
    case 'MATCH': {
      const sameTrack = state.track?.id === action.track.id || Boolean(state.track?.isrc && state.track.isrc === action.track.isrc)
      return { ...state, phase: 'matched', track: action.track, lyrics: sameTrack ? state.lyrics : undefined, anchor: action.anchor, consecutiveNoMatches: 0, stale: false, message: undefined }
    }
    case 'LYRICS': return { ...state, lyrics: action.lyrics }
    case 'NO_MATCH': {
      const failures = state.consecutiveNoMatches + 1
      if (state.track && failures < 2) return { ...state, phase: 'matched', consecutiveNoMatches: failures, stale: true, message: 'Holding the last match while we listen again.' }
      return { phase: 'no-match', consecutiveNoMatches: failures, stale: false, message: 'No song found yet. Keep the music playing.' }
    }
    case 'NETWORK_ERROR': return { ...state, phase: state.track ? 'matched' : 'listening', stale: true, message: action.message }
    case 'DENIED': return { ...initialSessionState, phase: 'denied' }
    case 'UNSUPPORTED': return { ...initialSessionState, phase: 'unsupported' }
    case 'STOP': return initialSessionState
  }
}
