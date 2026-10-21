/** Encode mono/stereo Float32 PCM as a 16-bit WAV blob. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const numCh = channels.length;
  const frames = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Concatenate chunks into one Float32Array. */
export function concatChunks(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Downsample PCM into `bins` columns of [min, max, rms] for a waveform thumbnail.
 */
export function waveformSummary(pcm: Float32Array, bins: number): Float32Array {
  const out = new Float32Array(bins * 3);
  if (pcm.length === 0) return out;
  const per = pcm.length / bins;
  for (let b = 0; b < bins; b++) {
    const s = Math.floor(b * per);
    const e = Math.min(pcm.length, Math.floor((b + 1) * per));
    let mn = 0;
    let mx = 0;
    let sq = 0;
    for (let i = s; i < e; i++) {
      const x = pcm[i];
      if (x < mn) mn = x;
      if (x > mx) mx = x;
      sq += x * x;
    }
    const n = Math.max(1, e - s);
    out[b * 3] = mn;
    out[b * 3 + 1] = mx;
    out[b * 3 + 2] = Math.sqrt(sq / n);
  }
  return out;
}
