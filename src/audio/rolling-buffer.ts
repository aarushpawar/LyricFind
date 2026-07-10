export interface PcmSnapshot {
  samples: Float32Array
  sampleRateHz: number
  sampleMs: number
  snapshotStartedAtMs: number
}

export class RollingPcmBuffer {
  private chunks: Float32Array[] = []
  private sampleCount = 0

  constructor(readonly sampleRateHz: number, readonly durationSeconds = 10) {}

  push(samples: Float32Array): void {
    if (!samples.length) return
    this.chunks.push(samples)
    this.sampleCount += samples.length
    const capacity = Math.floor(this.sampleRateHz * this.durationSeconds)
    while (this.sampleCount > capacity && this.chunks.length) {
      const excess = this.sampleCount - capacity
      const first = this.chunks[0]
      if (first.length <= excess) {
        this.chunks.shift()
        this.sampleCount -= first.length
      } else {
        this.chunks[0] = first.slice(excess)
        this.sampleCount -= excess
      }
    }
  }

  snapshot(nowMs = performance.now()): PcmSnapshot {
    const samples = new Float32Array(this.sampleCount)
    let offset = 0
    for (const chunk of this.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    const sampleMs = samples.length / this.sampleRateHz * 1000
    return { samples, sampleRateHz: this.sampleRateHz, sampleMs, snapshotStartedAtMs: nowMs - sampleMs }
  }

  clear(): void {
    this.chunks = []
    this.sampleCount = 0
  }

  get durationMs(): number {
    return this.sampleCount / this.sampleRateHz * 1000
  }
}
