import { useEffect, useRef } from 'react'
import { FileText } from 'lucide-react'
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
    return <div className="lyrics-placeholder"><span className="mini-spinner" /> Finding the best lyrics…</div>
  }
  if (lyrics.kind === 'missing') {
    return <div className="lyrics-notice"><span className="notice-glyph"><FileText /></span><strong>Lyrics aren’t available yet.</strong><span>We’ll keep the song in sync while you listen.</span></div>
  }
  if (lyrics.kind === 'instrumental') {
    return <div className="instrumental"><div className="instrumental-rings"><span /><span /><span /></div><strong>Instrumental track</strong><span>No words needed for this one.</span></div>
  }
  if (lyrics.kind === 'plain') {
    return <section className="plain-lyrics" aria-label="Unsynchronized lyrics"><div className="unsynced-label">Unsynchronized lyrics</div><p>{lyrics.text}</p></section>
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
