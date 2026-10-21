# Singing Practice

Personal singing practice tool: scales & arpeggios (**Play**), pitch-accuracy training (**Tune**), and backing-track practice with recorded takes (**Studio**). Built from [APP_SPEC.md](APP_SPEC.md).

Not a karaoke app: no songs, lyrics or scoring against tracks.

## Stack

- **Vite + React + TypeScript**, mobile-first dark UI, installable PWA (offline after first load).
- **Web Audio API** for everything audio:
  - Pitch detection runs in an `AudioWorklet` (off the UI thread): McLeod Pitch Method, voiced/unvoiced hysteresis, median-of-3, 2048-sample window every 50 ms, 55–1200 Hz.
  - One app-level mic service (`src/audio/mic/MicService.ts`) shared by all tabs; echo cancellation, noise suppression and auto-gain are **off**; a late mic start that resolves after a stop is released.
  - Backing-track player worklet with SoundTouch: speed and transpose are independent; loop points are sample-accurate and gapless.
  - Takes are captured from the same mic session (no second `getUserMedia`), head-trimmed 50 ms, optional offline spectral-gating denoise, stored as WAV.
- **IndexedDB** (`idb`) persists the actual track audio, per-track bookmarks / active loop / speed / transpose / position, and the last 5 takes. Settings and latency calibration persist in `localStorage`.
- **Capacitor** config included for wrapping as an Android/iOS app.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests: music theory, MPM, tracker, key detection, DSP
npm run build      # type-check + production bundle in dist/
npm run preview    # serve the production build
```

The audio side (worklets) does not always hot-reload cleanly: reload the page after changing files under `src/audio/`.

### Mobile (Capacitor)

```bash
npm run build
npx cap add android   # or ios (needs Android Studio / Xcode)
npx cap sync
npx cap open android
```

Add the microphone permission to the native project (`RECORD_AUDIO` on Android, `NSMicrophoneUsageDescription` on iOS).

### Dev helpers

- `?fakemic=220` replaces the microphone with a voice-like oscillator (sawtooth + vibrato) so the whole pipeline can be exercised where mic capture is blocked. `window.__fakemic.setFreq(hz)` and `.setLevel(0..1)` change it live. `?fakemic=file:/dev/voice.mp3` loops an audio file from `public/dev/` into the pitch engine instead (real-voice testing).
- In dev builds `window.__dev` exposes the studio store, both players and the settings store.
- `public/dev/test.wav` (git-ignored, regenerate with the snippet in git history or any audio file) is a 20 s stereo test track.

## Layout

```
src/
  music/        notes, scales/exercises, key detection
  audio/
    pitch/      MPM detector, voicing tracker, pitch worklet
    mic/        MicService (single shared mic)
    synth/      piano sampler (Salamander, CDN) + vocal/flute synths + fallback tone
    player/     stretch worklet (SoundTouch) + TrackPlayer
    recorder/   Recorder (PCM + pitch trace, latency-aligned)
    dsp/        WAV encode, FFT, denoise, waveform summary
    sequencer.ts  lookahead scheduler for scale runs (tempo changes apply live)
    latency.ts    click round-trip latency measurement
  state/        settings (persisted), pitch fan-out store, pitch history ring, studio store
  storage/      IndexedDB schema and helpers
  components/   Piano, BpmPill, NoteSlots, PianoRollGraph, LoudnessMeter, Waveform, SettingsSheet…
  tabs/         PlayTab, TuneTab, StudioTab (+ studio/TrackCard, MasterCard, TakesList)
```
