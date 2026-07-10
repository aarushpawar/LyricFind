import { useEffect, useRef } from 'react'
import { FileText, Music } from 'lucide-react'
import type { Lyrics } from '../types'

interface Props {
  lyrics: Lyrics | undefined
  activeIndex: number
}

export function KaraokeLyrics({ lyrics, activeIndex }: Props) {
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([])

  useEffect(() => {
    if (activeIndex < 0) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    lineRefs.current[activeIndex]?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
    })
  }, [activeIndex])

  if (!lyrics) {
    return <div className="lyrics-placeholder"><span className="mini-spinner" /> Finding lyrics…</div>
  }
  if (lyrics.kind === 'missing') {
    return <div className="lyrics-notice"><FileText /><strong>No lyrics for this one yet.</strong><span>LRCLIB doesn’t have this track. Recognition keeps running.</span></div>
  }
  if (lyrics.kind === 'instrumental') {
    return <div className="instrumental"><Music /><strong>Instrumental</strong><span>Nothing to sing on this one.</span></div>
  }
  if (lyrics.kind === 'plain') {
    return <section className="plain-lyrics" aria-label="Lyrics, not time-synced"><div className="unsynced-label">These lyrics aren’t time-synced</div><p>{lyrics.text}</p></section>
  }
  return (
    <section className="karaoke-lines" aria-label="Synchronized lyrics" aria-live="off">
      <div className="lyrics-spacer" />
      {lyrics.lines.map((line, index) => {
        const distance = activeIndex < 0 ? 2 : Math.abs(index - activeIndex)
        return (
          <p
            className={index === activeIndex ? 'lyric-line active' : 'lyric-line'}
            data-distance={Math.min(distance, 3)}
            key={`${line.time}-${index}`}
            ref={(node) => { lineRefs.current[index] = node }}
            aria-current={index === activeIndex ? 'true' : undefined}
          >{line.text}</p>
        )
      })}
      <div className="lyrics-spacer" />
    </section>
  )
}
