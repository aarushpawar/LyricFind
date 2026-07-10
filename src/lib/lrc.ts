import type { LyricLine } from '../types'

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(input: string): LyricLine[] {
  const lines: LyricLine[] = []
  let globalOffset = 0

  for (const rawLine of input.replace(/\r/g, '').split('\n')) {
    const offsetMatch = rawLine.match(/^\[offset:([+-]?\d+)\]$/i)
    if (offsetMatch) {
      globalOffset = Number(offsetMatch[1]) / 1000
      continue
    }

    const timestamps = [...rawLine.matchAll(TIMESTAMP)]
    if (!timestamps.length) continue
    const text = rawLine.replace(TIMESTAMP, '').trim()
    if (!text) continue

    for (const match of timestamps) {
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0
      lines.push({
        time: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + fraction + globalOffset),
        text,
      })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

export function activeLyricIndex(lines: LyricLine[], positionSeconds: number): number {
  let low = 0
  let high = lines.length - 1
  let result = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (lines[middle].time <= positionSeconds) {
      result = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}
