import { RollingPcmBuffer, type PcmSnapshot } from './rolling-buffer'

export class AudioCapture {
  private stream?: MediaStream
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private processor?: AudioWorkletNode
  private mutedOutput?: GainNode
  private buffer?: RollingPcmBuffer

  async start(deviceId?: string): Promise<void> {
    await this.stop()
    if (window.__LYRICFIND_TEST__) {
      if (window.__LYRICFIND_TEST__.microphoneError) throw new DOMException('Permission denied', window.__LYRICFIND_TEST__.microphoneError)
      const sampleMs = window.__LYRICFIND_TEST__.sampleMs ?? 10_000
      this.buffer = new RollingPcmBuffer(16_000, 10)
      const samples = new Float32Array(Math.floor(sampleMs * 16))
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 12) * 0.1
      this.buffer.push(samples)
      return
    }
    const constraints: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
    this.context = new AudioContext({ latencyHint: 'interactive' })
    await this.context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-capture-worklet.js`)
    await this.context.resume()
    this.buffer = new RollingPcmBuffer(this.context.sampleRate, 10)
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = new AudioWorkletNode(this.context, 'lyricfind-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    this.processor.port.onmessage = (event: MessageEvent<{ samples: Float32Array }>) => {
      if (event.data.samples instanceof Float32Array) this.buffer?.push(event.data.samples)
    }
    this.mutedOutput = this.context.createGain()
    this.mutedOutput.gain.value = 0
    this.source.connect(this.processor).connect(this.mutedOutput).connect(this.context.destination)
  }

  async stop(): Promise<void> {
    this.processor?.disconnect()
    this.source?.disconnect()
    this.mutedOutput?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.context && this.context.state !== 'closed') await this.context.close()
    this.buffer?.clear()
    this.stream = undefined
    this.context = undefined
    this.source = undefined
    this.processor = undefined
    this.mutedOutput = undefined
    this.buffer = undefined
  }

  snapshot(): PcmSnapshot | undefined {
    return this.buffer?.snapshot()
  }

  get bufferedMs(): number {
    return this.buffer?.durationMs ?? 0
  }

  static async microphones(): Promise<MediaDeviceInfo[]> {
    if (window.__LYRICFIND_TEST__?.devices) {
      return window.__LYRICFIND_TEST__.devices.map((device) => ({
        ...device, kind: 'audioinput', groupId: 'test', toJSON: () => device,
      }) as MediaDeviceInfo)
    }
    if (!navigator.mediaDevices?.enumerateDevices) return []
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')
  }
}
