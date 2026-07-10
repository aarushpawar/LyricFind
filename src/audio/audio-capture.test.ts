import { AudioCapture } from './audio-capture'

describe('AudioCapture startup cleanup', () => {
  it('stops the microphone and closes the context when worklet setup fails', async () => {
    const stopTrack = vi.fn()
    const closeContext = vi.fn().mockResolvedValue(undefined)
    const setupError = new Error('worklet failed to load')
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    })
    const OriginalAudioContext = globalThis.AudioContext
    const originalMediaDevices = navigator.mediaDevices

    class FailingAudioContext {
      state = 'running'
      sampleRate = 48_000
      destination = {}
      audioWorklet = { addModule: vi.fn().mockRejectedValue(setupError) }
      close = closeContext
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn() },
    })
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FailingAudioContext,
    })

    try {
      await expect(new AudioCapture().start()).rejects.toBe(setupError)
      expect(stopTrack).toHaveBeenCalledOnce()
      expect(closeContext).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices })
      Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: OriginalAudioContext })
    }
  })
})
