import { render } from '@testing-library/react'
import { KaraokeLyrics } from './KaraokeLyrics'

const lyrics = {
  kind: 'synced' as const,
  sourceId: 1,
  lines: [{ time: 0, text: 'First' }, { time: 2, text: 'Second' }],
}

describe('KaraokeLyrics scrolling', () => {
  it('still centers active lines without animation when reduced motion is requested', () => {
    const scrollIntoView = vi.fn()
    const originalMatchMedia = window.matchMedia
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      const view = render(<KaraokeLyrics lyrics={lyrics} activeIndex={0} />)
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'center' })
      view.rerender(<KaraokeLyrics lyrics={lyrics} activeIndex={1} />)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'center' })
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
      Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView })
    }
  })
})
