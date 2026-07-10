import { lyricsFromResult, normalizeMetadata, selectLyricsResult, type LrcLibResult } from './lrclib'

const candidates: LrcLibResult[] = [
  { id: 1, trackName: 'Other', artistName: 'Someone', instrumental: false, syncedLyrics: '[00:01]Wrong' },
  { id: 2, trackName: 'Halo', artistName: 'Beyonce', albumName: 'I Am... Sasha Fierce', instrumental: false, syncedLyrics: '[00:01]Remember' },
]

describe('LRCLIB selection', () => {
  it('normalizes punctuation, accents and version suffixes', () => {
    expect(normalizeMetadata('Halo (Remastered Version)')).toBe('halo')
    expect(normalizeMetadata('Beyoncé')).toBe('beyoncé')
  })

  it('matches title, artist, and album metadata', () => {
    expect(selectLyricsResult(candidates, { id: 'x', title: 'Halo', artist: 'Beyonce', album: 'I Am... Sasha Fierce' })?.id).toBe(2)
  })

  it('prioritizes an exact ISRC', () => {
    const isrc = { ...candidates[0], isrc: 'US-AAA-00-00001' }
    expect(selectLyricsResult([isrc, candidates[1]], { id: 'x', title: 'Halo', artist: 'Beyonce', isrc: 'US-AAA-00-00001' })?.id).toBe(1)
  })

  it('prefers synced, then plain, and marks instrumentals', () => {
    expect(lyricsFromResult(candidates[1]).kind).toBe('synced')
    expect(lyricsFromResult({ ...candidates[1], syncedLyrics: null, plainLyrics: 'Words' }).kind).toBe('plain')
    expect(lyricsFromResult({ ...candidates[1], instrumental: true }).kind).toBe('instrumental')
  })
})
