class LyricFindCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length || !channels[0]?.length) return true

    const frames = channels[0].length
    const mono = new Float32Array(frames)
    for (let channel = 0; channel < channels.length; channel += 1) {
      const input = channels[channel]
      for (let frame = 0; frame < frames; frame += 1) {
        mono[frame] += input[frame] / channels.length
      }
    }
    this.port.postMessage({ samples: mono, sampleRate }, [mono.buffer])
    return true
  }
}

registerProcessor('lyricfind-capture', LyricFindCaptureProcessor)
