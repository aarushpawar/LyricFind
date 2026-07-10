import { makePlaybackAnchor, playbackPosition } from './timing'

describe('playback timing', () => {
  it('advances from the beginning of the captured sample', () => {
    const anchor = makePlaybackAnchor(42, 0, 1_000)
    expect(playbackPosition(anchor, 6_000)).toBe(47)
  })

  it('applies Shazam timing skew and clamps pre-anchor time', () => {
    const anchor = makePlaybackAnchor(10, 0.01, 5_000)
    expect(playbackPosition(anchor, 15_000)).toBeCloseTo(20.1)
    expect(playbackPosition(anchor, 1_000)).toBe(10)
  })
})
