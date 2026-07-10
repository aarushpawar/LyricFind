import { ScanScheduler } from './scan-scheduler'

describe('ScanScheduler', () => {
  it('prevents overlap and spaces automatic scans', () => {
    const scheduler = new ScanScheduler()
    expect(scheduler.tryStart(0)).toBe(true)
    expect(scheduler.tryStart(13_000)).toBe(false)
    scheduler.finish()
    expect(scheduler.tryStart(11_999)).toBe(false)
    expect(scheduler.tryStart(12_000)).toBe(true)
  })

  it('allows manual scans immediately but never overlaps', () => {
    const scheduler = new ScanScheduler()
    expect(scheduler.tryStart(0)).toBe(true)
    scheduler.finish()
    expect(scheduler.tryStart(10, true)).toBe(true)
    expect(scheduler.tryStart(11, true)).toBe(false)
  })

  it('pauses automatic scans while hidden', () => {
    const scheduler = new ScanScheduler()
    scheduler.setVisible(false)
    expect(scheduler.tryStart(0)).toBe(false)
    scheduler.setVisible(true)
    expect(scheduler.tryStart(0)).toBe(true)
  })
})
