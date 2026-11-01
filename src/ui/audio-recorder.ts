const MAX_DURATION = 60_000;  // 60 seconds
const MIN_DURATION = 500;     // 500 ms
const SAMPLE_RATE = 16_000;

// Target encoding for uploads: mono at 16 kHz — the same format the robot's
// own recorder produces, so it's guaranteed-supported. The robot plays through
// a single speaker (mono is fine), and 16-bit/16 kHz keeps the WAV at
// ~1.9 MB/min, giving ~5 min of headroom under the robot's 10 MB limit
// (a stereo 48 kHz WAV would blow past 10 MB in ~50 s).
const UPLOAD_SAMPLE_RATE = 16_000;

/**
 * Decode any browser-supported audio file (MP3, WAV, OGG, M4A…), downmix to
 * mono and resample to 16 kHz, then encode as 16-bit PCM WAV — the only
 * format the robot's audiohub accepts. Uses decodeAudioData + an
 * OfflineAudioContext, so it works for whatever the platform can decode.
 */
export async function convertFileToWav(file: File): Promise<ArrayBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0)); // detaches its copy
  } finally {
    ctx.close().catch(() => {});
  }

  // Render through an OfflineAudioContext to downmix → mono and resample to
  // the target rate (connecting any channel count to a 1-channel destination
  // applies the standard down-mix).
  const frames = Math.max(1, Math.ceil(decoded.duration * UPLOAD_SAMPLE_RATE));
  const Offline = (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext) as typeof OfflineAudioContext;
  const offline = new Offline(1, frames, UPLOAD_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeAudioBufferToWav(rendered);
}

/** Encode a decoded AudioBuffer (any channel count / rate) to 16-bit PCM WAV. */
function encodeAudioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = numFrames * numChannels * bytesPerSample;

  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                                   // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels as 16-bit little-endian PCM.
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return wav;
}

// AudioWorklet processor (replaces the deprecated ScriptProcessorNode). Runs
// on the audio render thread and posts each 128-sample Float32 block back to
// the main thread. Loaded from a blob URL so there's no separate served file.
const WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private recording = false;
  private pcmData: Int16Array[] = [];
  private startTime = 0;
  private destroyed = false;

  async start(): Promise<void> {
    if (this.recording) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      });
      this.audioContext = audioContext;

      // Load the worklet module from a blob URL.
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await audioContext.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      // start() may have been cancelled (destroyed) while awaiting.
      if (this.destroyed) return;

      this.sourceNode = audioContext.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');

      this.pcmData = [];
      this.recording = true;
      this.startTime = Date.now();

      this.workletNode.port.onmessage = (event: MessageEvent) => {
        if (!this.recording) return;
        if (Date.now() - this.startTime > MAX_DURATION) {
          void this.stop();
          return;
        }
        const inputData = event.data as Float32Array;
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        this.pcmData.push(int16Data);
      };

      this.sourceNode.connect(this.workletNode);
      // Connect to destination so the graph is pulled; the worklet writes no
      // output, so nothing is actually played back (no feedback).
      this.workletNode.connect(audioContext.destination);
    } catch (err) {
      this.destroy();
      throw err;
    }
  }

  async stop(): Promise<ArrayBuffer | null> {
    if (!this.recording) return null;

    const duration = Date.now() - this.startTime;
    this.recording = false;

    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());

    if (duration < MIN_DURATION) {
      this.audioContext?.close().catch(() => {});
      return null;
    }

    const wav = this.encodeWav();
    this.audioContext?.close().catch(() => {});
    return wav;
  }

  private encodeWav(): ArrayBuffer {
    const totalSamples = this.pcmData.reduce((sum, data) => sum + data.length, 0);
    const wav = new ArrayBuffer(44 + totalSamples * 2);
    const view = new DataView(wav);
    const channels = 1;
    const sampleRate = SAMPLE_RATE;
    const bitDepth = 16;

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + totalSamples * channels * (bitDepth / 8), true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitDepth / 8), true);
    view.setUint16(32, channels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, totalSamples * channels * (bitDepth / 8), true);

    let offset = 44;
    for (const pcmChunk of this.pcmData) {
      for (let i = 0; i < pcmChunk.length; i++) {
        view.setInt16(offset, pcmChunk[i], true);
        offset += 2;
      }
    }

    return wav;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.recording = false;
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.audioContext = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.stream = null;
    this.pcmData = [];
  }
}
