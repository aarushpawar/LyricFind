import type { Lyrics, Track } from '../types'
import { parseLrc } from './lrc'

export interface LrcLibResult {
  id: number
  trackName: string
  artistName: string
  albumName?: string | null
  duration?: number
  instrumental: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
  isrc?: string | null
}

export function normalizeMetadata(value: string | undefined | null): string {
  return (value ?? '')
    .toLocaleLowerCase()
    .replace(/\([^)]*(?:feat|ft|remaster|version|edit)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:feat|ft|remaster|version|edit)[^\]]*\]/gi, '')
    .replace(/\b(feat|ft)\.?\s+.+$/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function candidateScore(candidate: LrcLibResult, track: Track): number {
  if (track.isrc && candidate.isrc?.toUpperCase() === track.isrc.toUpperCase()) return 1_000
  let score = 0
  const title = normalizeMetadata(track.title)
  const artist = normalizeMetadata(track.artist)
  const album = normalizeMetadata(track.album)
  if (normalizeMetadata(candidate.trackName) === title) score += 60
  else if (normalizeMetadata(candidate.trackName).includes(title)) score += 25
  if (normalizeMetadata(candidate.artistName) === artist) score += 35
  else if (normalizeMetadata(candidate.artistName).includes(artist)) score += 15
  if (album && normalizeMetadata(candidate.albumName) === album) score += 12
  if (candidate.syncedLyrics) score += 3
  else if (candidate.plainLyrics) score += 1
  return score
}

export function selectLyricsResult(candidates: LrcLibResult[], track: Track): LrcLibResult | undefined {
  return candidates
    .map((candidate) => ({ candidate, score: candidateScore(candidate, track) }))
    .filter(({ score }) => score >= 70 || score >= 1_000)
    .sort((a, b) => b.score - a.score)[0]?.candidate
}

export function lyricsFromResult(result: LrcLibResult | undefined): Lyrics {
  if (!result) return { kind: 'missing' }
  if (result.instrumental) return { kind: 'instrumental', sourceId: result.id }
  if (result.syncedLyrics) {
    const lines = parseLrc(result.syncedLyrics)
    if (lines.length) return { kind: 'synced', lines, sourceId: result.id, durationSeconds: result.duration }
  }
  if (result.plainLyrics?.trim()) return { kind: 'plain', text: result.plainLyrics.trim(), sourceId: result.id }
  return { kind: 'missing' }
}

export async function fetchLyrics(track: Track, signal?: AbortSignal): Promise<Lyrics> {
  async function request<T>(url: string, empty: T): Promise<T> {
    const response = await fetch(url, {
      signal,
      headers: { 'Lrclib-Client': 'LyricFind/0.1 (https://aarushpawar.github.io/LyricFind/)' },
    })
    if (response.status === 404) return empty
    if (!response.ok) throw new Error(`Lyrics lookup failed (${response.status})`)
    return await response.json() as T
  }

  // /api/get is an indexed exact-match lookup: far faster and a tiny payload vs. the
  // fuzzy /api/search (which returns ~60KB of candidates). LRCLIB does not index ISRC,
  // so a ?q=ISRC search always returns []; don't waste a round-trip on it.
  const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist })
  if (track.album) params.set('album_name', track.album)
  const exact = await request<LrcLibResult | null>(`https://lrclib.net/api/get?${params}`, null)
  if (exact) return lyricsFromResult(exact)

  // Fall back to fuzzy search only when the exact lookup misses.
  const candidates = await request<LrcLibResult[]>(`https://lrclib.net/api/search?${params}`, [])
  return lyricsFromResult(selectLyricsResult(candidates, track))
}
