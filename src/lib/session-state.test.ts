import { initialSessionState, sessionReducer } from './session-state'

const track = { id: '1', title: 'Song', artist: 'Artist' }
const anchor = { matchOffsetSeconds: 1, timeSkew: 0, snapshotStartedAtMs: 0 }

describe('sessionReducer', () => {
  it('retains a match once, then clears it after a second no-match', () => {
    const matched = sessionReducer(initialSessionState, { type: 'MATCH', track, anchor })
    const once = sessionReducer(matched, { type: 'NO_MATCH' })
    expect(once.track).toEqual(track)
    expect(once.stale).toBe(true)
    const twice = sessionReducer(once, { type: 'NO_MATCH' })
    expect(twice.track).toBeUndefined()
    expect(twice.phase).toBe('no-match')
  })

  it('retains lyrics through network failures', () => {
    const matched = sessionReducer(initialSessionState, { type: 'MATCH', track, anchor })
    const withLyrics = sessionReducer(matched, { type: 'LYRICS', lyrics: { kind: 'plain', text: 'Hi', sourceId: 1 } })
    const failed = sessionReducer(withLyrics, { type: 'NETWORK_ERROR', message: 'Offline' })
    expect(failed.lyrics?.kind).toBe('plain')
    expect(failed.stale).toBe(true)
  })

  it('returns to a clean onboarding state when listening stops', () => {
    const matched = sessionReducer(initialSessionState, { type: 'MATCH', track, anchor })
    expect(sessionReducer(matched, { type: 'STOP' })).toEqual(initialSessionState)
  })
})
