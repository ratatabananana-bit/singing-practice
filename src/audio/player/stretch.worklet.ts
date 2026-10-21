/// <reference types="@types/audioworklet" />
import { SoundTouch, SimpleFilter } from 'soundtouchjs';

declare const sampleRate: number;

/**
 * Track player worklet: independent tempo (speed) and pitch (transpose) via SoundTouch,
 * sample-accurate gapless loop points, and position reporting.
 */

const PAD = 16384 * 2; // zero padding after the end so SoundTouch flushes its pipeline

class LoopingSource {
  left: Float32Array = new Float32Array(0);
  right: Float32Array = new Float32Array(0);
  length = 0;
  cursor = 0;
  loopStart = 0;
  loopEnd = 0;
  loopOn = false;
  /** Silence inserted after each loop wrap (frames). */
  gapFrames = 0;
  private gapLeft = 0;
  /** Set to true by extract() when the loop wraps; the processor reports and clears it. */
  wrapped = false;
  /** Frames handed to the pipeline since the last seek (for latency compensation). */
  consumed = 0;
  ended = false;

  extract(target: Float32Array, numFrames: number, _position: number): number {
    if (this.length === 0) return 0;
    for (let i = 0; i < numFrames; i++) {
      if (this.gapLeft > 0) {
        target[i * 2] = 0;
        target[i * 2 + 1] = 0;
        this.gapLeft--;
        this.consumed++;
        continue;
      }
      if (this.loopOn && this.loopEnd > this.loopStart && this.cursor >= this.loopEnd) {
        this.cursor = this.loopStart;
        this.wrapped = true;
        if (this.gapFrames > 0) {
          this.gapLeft = this.gapFrames;
          target[i * 2] = 0;
          target[i * 2 + 1] = 0;
          this.gapLeft--;
          this.consumed++;
          continue;
        }
      }
      if (this.cursor < this.length) {
        target[i * 2] = this.left[this.cursor];
        target[i * 2 + 1] = this.right[this.cursor];
      } else {
        target[i * 2] = 0;
        target[i * 2 + 1] = 0;
        if (this.cursor >= this.length + PAD) {
          this.ended = true;
          return i;
        }
      }
      this.cursor++;
      this.consumed++;
    }
    return numFrames;
  }
}

class StretchProcessor extends AudioWorkletProcessor {
  private source = new LoopingSource();
  private st = new SoundTouch();
  private filter = new SimpleFilter(this.source, this.st);
  private inter = new Float32Array(128 * 2);
  private playing = false;
  private tempo = 1;
  private pitchSemis = 0;
  private output = 0; // output frames since last seek
  private reportCounter = 0;
  private bypass = true;

  constructor() {
    super();
    this.st.tempo = 1;
    this.st.pitch = 1;
    this.port.onmessage = (e: MessageEvent) => this.handle(e.data);
  }

  private handle(m: { type: string; [k: string]: unknown }): void {
    switch (m.type) {
      case 'load': {
        const s = this.source;
        s.left = m.left as Float32Array;
        s.right = (m.right as Float32Array) ?? s.left;
        s.length = s.left.length;
        s.cursor = 0;
        s.consumed = 0;
        s.ended = false;
        this.output = 0;
        this.filter.clear();
        this.playing = false;
        this.report(true);
        break;
      }
      case 'play':
        if (this.source.cursor >= this.source.length) this.seek(0);
        this.source.ended = false;
        this.playing = true;
        break;
      case 'pause':
        this.playing = false;
        this.report(true);
        break;
      case 'seek':
        this.seek(m.frames as number);
        break;
      case 'tempo':
        this.tempo = m.value as number;
        this.updateMode();
        break;
      case 'pitch':
        this.pitchSemis = m.value as number;
        this.updateMode();
        break;
      case 'loop': {
        const s = this.source;
        s.loopOn = m.on as boolean;
        s.loopStart = Math.max(0, Math.floor(m.start as number));
        s.loopEnd = Math.min(s.length, Math.floor(m.end as number));
        break;
      }
      case 'loopGap':
        this.source.gapFrames = Math.max(0, Math.floor(m.frames as number));
        break;
      case 'unload':
        this.source.left = new Float32Array(0);
        this.source.right = new Float32Array(0);
        this.source.length = 0;
        this.playing = false;
        this.filter.clear();
        break;
    }
  }

  private updateMode(): void {
    const wantBypass = Math.abs(this.tempo - 1) < 1e-4 && Math.abs(this.pitchSemis) < 1e-4;
    if (wantBypass !== this.bypass) {
      // Switch modes at the current displayed position to avoid a jump.
      const pos = this.displayedPosition();
      this.bypass = wantBypass;
      this.seek(pos);
    }
    this.st.tempo = this.tempo;
    this.st.pitch = Math.pow(2, this.pitchSemis / 12);
  }

  private seek(frames: number): void {
    const s = this.source;
    s.cursor = Math.max(0, Math.min(s.length, Math.floor(frames)));
    s.consumed = 0;
    s.ended = false;
    this.output = 0;
    this.filter.clear();
    this.report(true);
  }

  /** Source position corrected for frames sitting inside the SoundTouch pipeline. */
  private displayedPosition(): number {
    const s = this.source;
    if (this.bypass) return s.cursor;
    const inPipeline = s.consumed - this.output * this.tempo;
    let pos = s.cursor - inPipeline;
    if (s.loopOn && s.loopEnd > s.loopStart) {
      const len = s.loopEnd - s.loopStart;
      while (pos < s.loopStart && s.cursor >= s.loopStart) pos += len;
    }
    return Math.max(0, Math.min(s.length, pos));
  }

  private report(force = false): void {
    if (this.source.wrapped) {
      this.source.wrapped = false;
      this.port.postMessage({ type: 'wrap' });
    }
    this.reportCounter++;
    if (force || this.reportCounter >= 8) {
      this.reportCounter = 0;
      this.port.postMessage({ type: 'position', frames: this.displayedPosition(), playing: this.playing });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const L = out[0];
    const R = out[1] ?? out[0];
    const n = L.length;
    if (!this.playing || this.source.length === 0) {
      L.fill(0);
      if (R !== L) R.fill(0);
      return true;
    }
    if (this.bypass) {
      const inter = this.inter;
      const got = this.source.extract(inter, n, 0);
      for (let i = 0; i < n; i++) {
        L[i] = i < got ? inter[i * 2] : 0;
        if (R !== L) R[i] = i < got ? inter[i * 2 + 1] : 0;
      }
      this.output += got;
      if (this.source.ended || (got < n && !this.source.loopOn)) this.finish();
      this.report();
      return true;
    }
    const got = this.filter.extract(this.inter, n);
    for (let i = 0; i < n; i++) {
      L[i] = i < got ? this.inter[i * 2] : 0;
      if (R !== L) R[i] = i < got ? this.inter[i * 2 + 1] : 0;
    }
    this.output += got;
    if (got === 0 && this.source.ended) this.finish();
    this.report();
    return true;
  }

  private finish(): void {
    this.playing = false;
    this.source.cursor = this.source.length;
    this.port.postMessage({ type: 'ended' });
    this.report(true);
  }
}

registerProcessor('stretch-processor', StretchProcessor);
