import type { FingerprintWorkerResponse } from './fingerprint.types'
import type { PcmSnapshot } from './rolling-buffer'

export interface Fingerprint {
  signatureUri: string
  sampleMs: number
  snapshotStartedAtMs: number
}

export class FingerprintClient {
  private worker?: Worker
  private disposed = false
  private pending = new Map<string, { resolve: (value: Fingerprint) => void; reject: (reason: Error) => void; snapshotStartedAtMs: number }>()

  constructor() {
    if (window.__LYRICFIND_TEST__) return
    this.startWorker()
  }

  private startWorker(): Worker {
    if (this.disposed) throw new Error('Fingerprint worker has been stopped.')
    const worker = new Worker(new URL('./fingerprint.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<FingerprintWorkerResponse>) => {
      const message = event.data
      if (message.type === 'ready') return
      if (!message.requestId) return
      const pending = this.pending.get(message.requestId)
      if (!pending) return
      this.pending.delete(message.requestId)
      if (message.type === 'error') pending.reject(new Error(message.message))
      else pending.resolve({ signatureUri: message.signatureUri, sampleMs: message.sampleMs, snapshotStartedAtMs: pending.snapshotStartedAtMs })
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault()
      this.handleWorkerFailure(worker, 'Fingerprint worker failed to load or crashed.')
    })
    worker.addEventListener('messageerror', () => {
      this.handleWorkerFailure(worker, 'Fingerprint worker returned an unreadable message.')
    })
    return worker
  }

  private handleWorkerFailure(worker: Worker, message: string): void {
    if (this.worker !== worker) return
    worker.terminate()
    this.worker = undefined
    this.rejectPending(new Error(message))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  create(snapshot: PcmSnapshot): Promise<Fingerprint> {
    if (window.__LYRICFIND_TEST__) {
      snapshot.samples.fill(0)
      return Promise.resolve({
        signatureUri: window.__LYRICFIND_TEST__.signatureUri ?? 'data:audio/vnd.shazam.sig;base64,dGVzdA==',
        sampleMs: snapshot.sampleMs,
        snapshotStartedAtMs: snapshot.snapshotStartedAtMs,
      })
    }
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, snapshotStartedAtMs: snapshot.snapshotStartedAtMs })
      try {
        const worker = this.worker ?? this.startWorker()
        worker.postMessage({
          type: 'fingerprint', requestId, samples: snapshot.samples,
          sampleRateHz: snapshot.sampleRateHz, channelCount: 1,
        }, [snapshot.samples.buffer])
      } catch (error) {
        this.pending.delete(requestId)
        snapshot.samples.fill(0)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  terminate(): void {
    this.disposed = true
    this.worker?.terminate()
    this.worker = undefined
    this.rejectPending(new Error('Fingerprint worker stopped.'))
  }
}
