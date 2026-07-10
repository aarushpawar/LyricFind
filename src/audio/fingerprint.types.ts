/** Messages accepted by the browser-side Shazam fingerprint worker. */
export interface FingerprintWorkerRequest {
  type: 'fingerprint'
  requestId: string
  /** Interleaved floating-point PCM in the Web Audio API's -1..1 range. */
  samples: Float32Array
  sampleRateHz: number
  channelCount: number
}

export interface FingerprintWorkerReadyMessage {
  type: 'ready'
}

export interface FingerprintWorkerResultMessage {
  type: 'fingerprint'
  requestId: string
  signatureUri: string
  /** Duration represented by the generated signature after 16 kHz resampling. */
  sampleMs: number
  numberSamples: number
}

export type FingerprintWorkerErrorCode =
  | 'busy'
  | 'initialization_failed'
  | 'invalid_request'
  | 'fingerprint_failed'

export interface FingerprintWorkerErrorMessage {
  type: 'error'
  requestId?: string
  code: FingerprintWorkerErrorCode
  message: string
}

export type FingerprintWorkerResponse =
  | FingerprintWorkerReadyMessage
  | FingerprintWorkerResultMessage
  | FingerprintWorkerErrorMessage
