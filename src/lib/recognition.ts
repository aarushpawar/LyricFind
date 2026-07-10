import type { RecognitionResult } from '../types'
import type { Fingerprint } from '../audio/fingerprint-client'

export function recognitionEndpoint(): string {
  return (import.meta.env.VITE_RECOGNITION_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}

export function getClientId(): string {
  const key = 'lyricfind-client-id'
  let value = localStorage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    localStorage.setItem(key, value)
  }
  return value
}

export async function recognize(fingerprint: Fingerprint, signal?: AbortSignal): Promise<RecognitionResult> {
  const endpoint = recognitionEndpoint()
  if (!endpoint) throw new Error('Recognition service is not configured.')
  const response = await fetch(`${endpoint}/recognize`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: getClientId(), signatureUri: fingerprint.signatureUri, sampleMs: fingerprint.sampleMs }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string | { message?: string } } | null
    const detail = typeof body?.error === 'string' ? body.error : body?.error?.message
    throw new Error(detail || `Recognition failed (${response.status})`)
  }
  return response.json() as Promise<RecognitionResult>
}
