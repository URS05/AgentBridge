/**
 * Pure Web Audio API 16kHz Mono PCM WAV recorder with live amplitude analyser.
 * Produces standard RIFF/WAVE (`audio/wav`) accepted by Sarvam AI `/speech-to-text`
 * without browser WebM/Opus codec incompatibilities.
 */

export interface LiveWavRecorder {
  stop: () => Promise<{ base64: string; mimeType: 'audio/wav'; durationMs: number }>;
  cancel: () => void;
}

function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (outputRate >= inputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function startLiveWavRecorder(
  onLevels: (bars: number[]) => void
): Promise<LiveWavRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
  });

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  const chunks: Float32Array[] = [];
  const startedAt = Date.now();
  let rafId = 0;
  let closed = false;

  processor.onaudioprocess = (e) => {
    if (closed) return;
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(analyser);
  analyser.connect(processor);
  processor.connect(ctx.destination);

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const sampleBars = () => {
    if (closed) return;
    analyser.getByteFrequencyData(freqData);
    // Pick 12 balanced frequency bands normalized 0.12..1
    const bars: number[] = [];
    const step = Math.max(1, Math.floor(freqData.length / 12));
    for (let i = 0; i < 12; i += 1) {
      const val = freqData[Math.min(freqData.length - 1, i * step)] / 255;
      bars.push(Math.max(0.14, Math.min(1, val * 1.35)));
    }
    onLevels(bars);
    rafId = requestAnimationFrame(sampleBars);
  };
  rafId = requestAnimationFrame(sampleBars);

  const teardown = async () => {
    closed = true;
    cancelAnimationFrame(rafId);
    try {
      processor.disconnect();
      analyser.disconnect();
      source.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    stream.getTracks().forEach((t) => t.stop());
    if (ctx.state !== 'closed') {
      await ctx.close().catch(() => {});
    }
  };

  return {
    stop: async () => {
      const durationMs = Date.now() - startedAt;
      await teardown();

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Float32Array(totalLength);
      let pos = 0;
      for (const c of chunks) {
        merged.set(c, pos);
        pos += c.length;
      }

      const targetRate = 16000;
      const resampled = downsampleBuffer(merged, ctx.sampleRate, targetRate);
      const wavBuffer = encodeWavPcm16(resampled, targetRate);
      return {
        base64: arrayBufferToBase64(wavBuffer),
        mimeType: 'audio/wav',
        durationMs,
      };
    },
    cancel: () => {
      void teardown();
    },
  };
}
