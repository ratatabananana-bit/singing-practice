# Singing Practice

Personal singing practice tool: scales & arpeggios (**Play**), pitch-accuracy training (**Tune**), and backing-track practice with recorded takes (**Studio**). Built from [APP_SPEC.md](APP_SPEC.md).

Not a karaoke app: no songs, lyrics or scoring against tracks.

## What it does (vs. the established apps)

- **Play**: exercise player with degree-labelled scales and vocal patterns, intro cue, auto-advance within a vocal range (turn around / stop at the edge, sing-to-find range), listen-then-sing mode, gap between runs, a run view with target blocks + sung trace + per-note hit colours, and an end-of-run score (hits, avg cents, precision, sustain, flat/sharp). Modelled on Singing Carrots, Erol Singer's Studio, Warm Vox.
- **Tune**: tap-a-key target tuner with adjustable tolerance (default 20¢), cents + note + Hz readout, cents graph with note-labelled rows, hold-to-nail with steadiness, session bias (precise / flat / sharp, average, steadiness), key guess, and the same exercise mode as Play. Modelled on Vocal Pitch Monitor, Sing-inTuna, Cleartune, Singing Carrots.
- **Studio**: Transpose-style marker timeline with A–B loops between any two markers, named coloured sections (Verse, Chorus…) that loop with one tap, YouTube import via a local yt-dlp helper, gapless looping with an optional gap, speed 25–200% and transpose ±12 st plus ±50¢ fine tune, speed trainer (ramp per loop pass), count-in before recording, takes with waveform, star (kept + drawn as a reference line under the live pitch while the track plays), WAV export, offline denoise. Modelled on Transpose, Anytune, Capo, GarageBand, Voloco.

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

### YouTube helper (optional)

"YouTube link" in Studio asks a small local helper to fetch the audio with yt-dlp + ffmpeg (both must be on PATH):

```bash
npm run server      # http://localhost:5174, GET /api/yt?url=…
```

The dev server proxies `/api` to it. From a phone, set Settings → YouTube helper to the PC address (http://<pc-ip>:5174). Downloading YouTube audio may be against YouTube's terms; use it for your own practice.

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
