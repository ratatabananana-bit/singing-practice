/// <reference types="vite/client" />
declare module 'soundtouchjs' {
  export class SoundTouch {
    tempo: number;
    pitch: number;
    rate: number;
    pitchSemitones: number;
    clear(): void;
  }
  export class SimpleFilter {
    constructor(source: { extract(target: Float32Array, numFrames: number, position: number): number }, pipe: SoundTouch, onEnd?: () => void);
    sourcePosition: number;
    extract(target: Float32Array, numFrames: number): number;
    clear(): void;
  }
}
declare module '*?worker&url' {
  const url: string;
  export default url;
}
