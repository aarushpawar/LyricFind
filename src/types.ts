export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  isrc?: string
}

export interface RecognitionMatch {
  status: 'match'
  track: Track
  matchOffsetSeconds: number
  timeSkew: number
}

export interface RecognitionNoMatch {
  status: 'no_match'
}

export type RecognitionResult = RecognitionMatch | RecognitionNoMatch

export interface LyricLine {
  time: number
  text: string
}

export type Lyrics =
  | { kind: 'synced'; lines: LyricLine[]; sourceId: number }
  | { kind: 'plain'; text: string; sourceId: number }
  | { kind: 'instrumental'; sourceId: number }
  | { kind: 'missing' }

export interface PlaybackAnchor {
  matchOffsetSeconds: number
  timeSkew: number
  snapshotStartedAtMs: number
}
