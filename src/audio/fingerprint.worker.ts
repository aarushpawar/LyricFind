/// <reference lib="webworker" />

import initShazamio, { DecodedSignature } from 'shazamio-core/web'

import type {
  FingerprintWorkerErrorCode,
  FingerprintWorkerRequest,
  FingerprintWorkerResponse,
} from './fingerprint.types'

const worker = self as unknown as DedicatedWorkerGlobalScope

let initialization: Promise<void> | undefined
let busy = false

function post(message: FingerprintWorkerResponse): void {
  worker.postMessage(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function postError(
  code: FingerprintWorkerErrorCode,
  message: string,
  requestId?: string,
): void {
  post({ type: 'error', code, message, requestId })
}

function initialize(): Promise<void> {
  initialization ??= initShazamio().then(() => undefined)
  return initialization
}

function isFingerprintRequest(value: unknown): value is FingerprintWorkerRequest {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<FingerprintWorkerRequest>
  return (
    candidate.type === 'fingerprint' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    candidate.samples instanceof Float32Array &&
    candidate.samples.length > 0 &&
    typeof candidate.sampleRateHz === 'number' &&
    Number.isFinite(candidate.sampleRateHz) &&
    candidate.sampleRateHz >= 8_000 &&
    candidate.sampleRateHz <= 384_000 &&
    typeof candidate.channelCount === 'number' &&
    Number.isInteger(candidate.channelCount) &&
    candidate.channelCount >= 1 &&
    candidate.channelCount <= 32 &&
    candidate.samples.length % candidate.channelCount === 0
  )
}

async function fingerprint(request: FingerprintWorkerRequest): Promise<void> {
  if (busy) {
    postError('busy', 'A fingerprint is already being generated.', request.requestId)
    request.samples.fill(0)
    return
  }

  busy = true
  let signature: DecodedSignature | undefined

  try {
    try {
      await initialize()
    } catch (error) {
      // Permit a later request to retry a transient WASM asset/load failure.
      initialization = undefined
      postError(
        'initialization_failed',
        `Could not initialize the fingerprint engine: ${errorMessage(error)}`,
        request.requestId,
      )
      return
    }

    signature = DecodedSignature.new(
      request.samples,
      request.sampleRateHz,
      request.channelCount,
    )

    // Copy every WASM-backed getter before free() releases its allocation.
    const signatureUri = signature.uri
    const sampleMs = signature.samplems
    const numberSamples = signature.number_samples

    if (!signatureUri) {
      throw new Error('The fingerprint engine returned an empty signature.')
    }

    post({
      type: 'fingerprint',
      requestId: request.requestId,
      signatureUri,
      sampleMs,
      numberSamples,
    })
  } catch (error) {
    postError(
      'fingerprint_failed',
      `Could not generate a fingerprint: ${errorMessage(error)}`,
      request.requestId,
    )
  } finally {
    signature?.free()
    // The ArrayBuffer should be transferred to this worker by the caller. Wipe
    // its PCM contents promptly rather than waiting for garbage collection.
    request.samples.fill(0)
    busy = false
  }
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isFingerprintRequest(event.data)) {
    const requestId =
      typeof event.data === 'object' &&
      event.data !== null &&
      'requestId' in event.data &&
      typeof event.data.requestId === 'string'
        ? event.data.requestId
        : undefined
    postError('invalid_request', 'Invalid fingerprint worker request.', requestId)
    return
  }

  void fingerprint(event.data)
})

// Warm the 1.5 MB WASM module while the microphone buffer is filling. Requests
// arriving during startup share this promise rather than starting a second load.
void initialize()
  .then(() => post({ type: 'ready' }))
  .catch((error: unknown) => {
    initialization = undefined
    postError(
      'initialization_failed',
      `Could not initialize the fingerprint engine: ${errorMessage(error)}`,
    )
  })

export {}
