import { RollingPcmBuffer } from './rolling-buffer'

describe('RollingPcmBuffer', () => {
  it('keeps only the newest configured duration and copies snapshots', () => {
    const buffer = new RollingPcmBuffer(2, 2)
    buffer.push(Float32Array.from([1, 2, 3]))
    buffer.push(Float32Array.from([4, 5]))
    const snapshot = buffer.snapshot(10_000)
    expect([...snapshot.samples]).toEqual([2, 3, 4, 5])
    expect(snapshot.sampleMs).toBe(2_000)
    expect(snapshot.snapshotStartedAtMs).toBe(8_000)
    snapshot.samples[0] = 99
    expect([...buffer.snapshot().samples]).toEqual([2, 3, 4, 5])
  })
})
