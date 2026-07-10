import type { PlaybackAnchor } from '../types'

export function playbackPosition(anchor: PlaybackAnchor, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - anchor.snapshotStartedAtMs) / 1000
  return Math.max(0, anchor.matchOffsetSeconds + elapsed * (1 + anchor.timeSkew))
}

export function makePlaybackAnchor(
  matchOffsetSeconds: number,
  timeSkew: number,
  snapshotStartedAtMs: number,
): PlaybackAnchor {
  return { matchOffsetSeconds, timeSkew, snapshotStartedAtMs }
}
