import { FingerprintClient } from './fingerprint-client'
import type { PcmSnapshot } from './rolling-buffer'

class FakeWorker {
  static instances: FakeWorker[] = []
  listeners = new Map<string, Array<(event: Event) => void>>()
  messages: unknown[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function snapshot(): PcmSnapshot {
  return {
    samples: Float32Array.from([0.1, 0.2]),
    sampleRateHz: 16_000,
    sampleMs: 1_000,
    snapshotStartedAtMs: 5_000,
  }
}

describe('FingerprintClient worker failures', () => {
  it('rejects pending work after a crash and recreates the worker on retry', async () => {
    const OriginalWorker = globalThis.Worker
    const originalHarness = window.__LYRICFIND_TEST__
    FakeWorker.instances = []
    window.__LYRICFIND_TEST__ = undefined
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })

    try {
      const client = new FingerprintClient()
      const firstResult = client.create(snapshot())
      const firstWorker = FakeWorker.instances[0]
      firstWorker.emit('error', new Event('error', { cancelable: true }))
      await expect(firstResult).rejects.toThrow('failed to load or crashed')
      expect(firstWorker.terminated).toBe(true)

      const secondResult = client.create(snapshot())
      const secondWorker = FakeWorker.instances[1]
      const request = secondWorker.messages[0] as { requestId: string }
      secondWorker.emit('message', new MessageEvent('message', { data: {
        type: 'fingerprint',
        requestId: request.requestId,
        signatureUri: 'data:audio/vnd.shazam.sig;base64,test',
        sampleMs: 1_000,
        numberSamples: 16_000,
      } }))
      await expect(secondResult).resolves.toMatchObject({ sampleMs: 1_000, snapshotStartedAtMs: 5_000 })
      client.terminate()
    } finally {
      window.__LYRICFIND_TEST__ = originalHarness
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: OriginalWorker })
    }
  })
})
