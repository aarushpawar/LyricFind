import { activeLyricIndex, parseLrc } from './lrc'

describe('parseLrc', () => {
  it('parses, sorts, and expands timestamps', () => {
    expect(parseLrc('[00:02.50][00:03.750]Hello\n[00:01]First')).toEqual([
      { time: 1, text: 'First' },
      { time: 2.5, text: 'Hello' },
      { time: 3.75, text: 'Hello' },
    ])
  })

  it('applies offset metadata and ignores tags', () => {
    expect(parseLrc('[ar:Artist]\n[offset:-500]\n[00:01.00]Line')).toEqual([
      { time: 0.5, text: 'Line' },
    ])
  })
})

describe('activeLyricIndex', () => {
  const lines = [{ time: 2, text: 'a' }, { time: 5, text: 'b' }]
  it('returns the latest line at or before the playhead', () => {
    expect(activeLyricIndex(lines, 1)).toBe(-1)
    expect(activeLyricIndex(lines, 2)).toBe(0)
    expect(activeLyricIndex(lines, 9)).toBe(1)
  })
})
