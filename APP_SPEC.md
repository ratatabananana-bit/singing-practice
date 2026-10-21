# Singing Practice App — Functional Spec for Rewrite

Purpose of this document: describe what the app is supposed to do, tab by tab, plus the hard-won gotchas from the first build. No code. Use this as the brief for a clean rewrite.

---

## 1. What the app is (and is not)

**Is:** a personal singing *practice* tool. Warm up on scales, train pitch accuracy against a target note, and record yourself over a backing track to review takes.

**Is not:** a karaoke app. No song library, no lyrics, no sing-along charts, no multiplayer, no scoring against songs. Don't build any of that.

**Target platform:** mobile app (phone first). The first build was Flutter web as a prototype; the rewrite should assume mobile, with web as a nice-to-have.

**Visual style:** dark theme. Near-black background, layered dark-grey cards, soft borders, one warm yellow accent. Status colors: green = good, orange/amber = warning, red = bad. Compact pills and chips rather than big cards wherever possible — screen space matters.

**Navigation:** three bottom tabs — **Play**, **Tune**, **Studio** — plus a settings sheet opened from a gear icon in the header. The header shows the current tab name and a one-line subtitle.

---

## 2. Play tab — "Scales & arpeggios"

### Goal
Play scale exercises at a chosen key and tempo so the singer can follow along, with live feedback on whether they're hitting the note currently being played.

### Functionality
- **Piano keyboard** (horizontally scrollable, ~C1 to C7). Tapping a key sets the root note, plays it, and stops any running sequence. Keys in the current scale are highlighted; the note currently sounding is highlighted differently. The keyboard auto-scrolls to keep the root centered.
- **Scale picker:** Major, Natural Minor, Harmonic Minor, Melodic Minor, Major Pentatonic, Minor Pentatonic, Blues, Dorian, Mixolydian, Major Arpeggio, Minor Arpeggio, Chromatic. Scales can be hidden via settings (at least one must stay visible).
  - **Default Major exercise is 5 notes (do-re-mi-fa-sol, e.g. C to G), not the full octave.** Going up to the next C was too much for the user.
- **Direction:** Up, Down, or Up-then-Down (up-down doesn't repeat the top note).
- **Now Playing card** (the main card at top):
  - Big root note name + octave, scale name underneath.
  - Play/pause button and a restart button.
  - "SEQUENCE" row showing each note of the exercise as a chip; the sounding note lights up in the accent color. A return-arrow chip shows when direction is up-down.
  - **Live tuner pill** placed directly next to the "NOW PLAYING" label (so the eye can compare quickly).
  - **BPM pill** on the right of the header.
  - **Auto-advance pill** next to the "SEQUENCE" label.
- **Tempo (BPM pill + popover):** tapping the BPM pill opens a small popover with:
  - minus/plus stepper (range 40–240 BPM, hold to repeat),
  - Slow / Medium / Fast presets (72 / 120 / 168 BPM),
  - Tap-tempo button (averages the last few taps, resets after 2 s idle).
  - The pill shows only the number ("120 BPM"), never the preset name.
  - Tapping anywhere outside the pill or popover closes it.
  - Changing tempo mid-play takes effect without restarting the sequence.
- **Auto-advance:** after each run of the scale, move the root up (or down) a half step and play again. Pill cycles Off → Up → Down → Off on tap.
- **Scale intro (setting):** before the exercise, play a cue so the singer hears the key:
  - Off,
  - 1–5 (root, fifth, one silent beat, then start),
  - 1–3–5 (root, third, fifth, one silent beat, then start).
  - The intro also plays before each auto-advanced key change.
- **Sound modes (setting):** sampled grand piano, synthesized "vocal aah", flute. Fallback simple tone while samples load.

### Tuner pill behavior (Play tab)
- Shows the note the singer is currently singing (letter, sharp sign, octave). Shows a dash when silent.
- **Fixed width, fixed slots** for letter / sharp / octave. The pill must never resize and the letter must never shift sideways when a sharp appears — that caused a flicker that was hard on the eyes.
- **No cents number** in this pill — too hard to read at a glance.
- **Color = match against the note currently being played in the sequence**, four tiers:
  - **Green:** same note as target and within ~35 cents — locked on.
  - **Yellow:** same note name as target but noticeably flat/sharp — right note, tune it.
  - **Amber/accent:** a different note that *is* in the scale — probably lagging or ahead of the sequence.
  - **Red:** a note outside the scale — totally off.
- Display smoothing: take the median of the last 3 detected notes to kill single-frame glitches. **Do not** use a weighted moving average on the frequency — the user explicitly rejected it because it made the display lag behind their voice.
- Green should be reasonably easy to hit — the user wants the "dopamine" of seeing green. Too-tight tolerance made it frustrating.

---

## 3. Tune tab — "Vocal tuner"

### Goal
Focused pitch-accuracy training: pick a target note (or a scale), sing it, and hold it in tune for a set time to "nail" it.

### Functionality
- **Target selection:** tap a piano key to set the target. A play button replays the target note.
- **Modes:**
  - *One Note* — target is the tapped key.
  - *Scale* — target walks through the notes of a chosen scale; after a note is nailed, it auto-advances to the next one. Tapping a key in scale mode plays the scale as an intro.
- **Tuner card:**
  - Big target note name (this is the *target*, not what's being sung).
  - "YOU" readout: signed cents off target (e.g. "+12¢") and the detected frequency in Hz. Target frequency shown underneath.
  - **Pitch graph:** scrolling history (~7 s) of cents deviation from target. Center dashed line = target; grid lines and note labels at ±1 and ±2 semitones; a green band marks the in-tune zone (±25 cents); the trace is green when in tune, orange otherwise, grey when silent; a dot marks the current value.
  - **Loudness meter:** vertical segmented dB meter beside the graph with a "sweet spot" range; status text says Too quiet / A touch soft / Good level / A touch hot / Too loud.
  - **Status row:** In tune / Flat / Sharp / Far off, plus the loudness status, plus "hold X.Xs / Y.Ys".
  - **Hold progress bar** across the top of the card fills while in tune and drains slowly when not.
  - **LIVE / PAUSED pill** — tap to stop/start the mic.
  - **Detected key pill** (e.g. "C maj 78%") — guesses the key/scale the singer is in from the last ~10 s of sung notes. Grey when unsure, orange when moderately sure, green when confident.
- **Nailing a note:** stay within the in-tune zone (above the silence gate) for the hold duration → logged as nailed.
- **Session card:** list of nailed notes with their cents error, and an "X / Y nailed" counter. Empty state: "Hold a note to log it."
- **Settings that affect this tab:** hold duration (0.5–5 s), silence gate (dB threshold below which input counts as silence).

### Smoothing used here
- Median-of-3 on the raw cents (kills outliers), then a light moving average for the graph and in-tune judgement. On this tab some smoothing is fine because it's a precision tool; on the Play tab it is not.
- When the singer goes quiet, the graph **holds** its last value rather than snapping back to zero.

---

## 4. Studio tab — "Track & takes"

### Goal
Load a backing track (a song file from the device), practice over it with loop points, record takes of yourself singing, and immediately listen back with a pitch graph to see where you went off.

### 4a. Track player (top card)
- **Load a track** from device storage (any audio file).
- **"Select last track"** — re-open the most recently loaded track, **including after the app is closed and reopened.** (This never worked in the first build — the file was only kept in memory.) Persist the actual audio file, not just its name.
- Play / pause, seek bar with current time and duration.
- **Speed** control (slow down for practice) and **transpose** (shift key in semitones) — independent of each other (speed change must not change pitch, transpose must not change speed).
- **Bookmarks / pins:** drop a marker at the current playhead; rename it; set its time precisely by typing (m:ss.cc); re-pin it to the current playhead; sort by time; jump to it.
- **Loop sections:** the span between two consecutive bookmarks is a loop section. Selecting one loops that section seamlessly. Loop on/off toggle.
- **Bookmarks and the active loop section must be remembered per track across app restarts.** (Also never worked in the first build.)
- Expandable card to show/hide the advanced controls.

### 4b. Master card (live pitch + recording)
- **Header:** "MASTER" label, a compact chromatic tuner showing the sung note **with** a cents readout, and a LIVE / RECORDING / REPLAY / PAUSED status pill (tap to pause/resume listening).
- **Big pitch graph** (tall, the hero element):
  - Piano-roll style: one horizontal row per semitone, ~7 semitones above and below center.
  - Note names labeled on the rows; the row the singer is currently on gets highlighted.
  - Rows tinted alternately per octave; sharp rows show a dark "black key" block at the edge so it reads like a sideways keyboard.
  - The view auto-centers smoothly on wherever the singer is singing.
  - Trace line of sung pitch scrolling right-to-left; gaps where silent.
  - **Held-note bars:** when the singer holds a note steady for a moment, fill a solid bar along that note's row for the duration — makes sustained notes easy to see.
  - **Timeline** across the top (mm:ss labels) with a small triangle cursor marking "now".
  - Scroll speed adjustable in settings.
- **Loudness meter** beside the graph, with a peak-hold marker and a red **CLIP** badge when input is near full scale.
- **Record section** (below the graph, separated by a thin divider — not its own card, to save space):
  - Status text (READY / RECORDING), round red record button (plain, no glow, no ring).
  - Toggle: **Auto-play last take** — play the take back immediately after recording stops.
  - Toggle: **Denoise** — clean background noise from the take after recording (not in real time).

### 4c. Takes list
- Keep the last 5 takes (oldest dropped).
- Each take card: take number, duration, time recorded, waveform thumbnail, play/pause, scrub, delete.
- Waveform should look like a proper filled waveform (min/max shape) with a softer loudness envelope, and a playhead line while playing. The first build's single spiky line looked bad.
- Playing a take also replays its pitch trace in the Master graph, synced to playback position.
- Playback must allow precise scrubbing and seamless looping (no click/stutter at the loop point).

---

## 5. Settings sheet

- **Visible scales** — chips to hide/show scales on the Play tab.
- **Sound** — Piano / Vocal / Flute.
- **Scale intro** — Off / 1–5 / 1–3–5.
- **Tuner:**
  - Hold duration (Tune tab).
  - Silence gate in dB — below this, input is treated as silence everywhere (must actually gate the input, not just dim the display — in the first build it only dimmed the Studio graph and did nothing useful).
  - Graph speed (Studio).
- **Input latency** — measure the delay between sound and mic (play a click, listen for it; needs speakers, not earphones), plus a manual offset slider and reset. Used to line up recorded pitch with what the singer heard. Should be saved across restarts.
- **Debug: pitch detection** — sliders and on/off switches for every stage of the pitch pipeline (confidence thresholds, frequency range, smoothing) plus "reset to defaults". The user wanted this to diagnose dropouts precisely; keep it, but tucked away.

---

## 6. Shared pitch engine — requirements

All three tabs depend on one pitch detector. This is the core of the app; most of the first build's pain lived here.

- Input: microphone, mono, analysed in ~2048-sample windows about every 50 ms.
- Output per frame: detected frequency (or "unvoiced") and loudness in dB.
- Algorithm: use a modern singing-friendly detector (McLeod Pitch Method / YIN family or better). The original simple autocorrelation dropped out constantly on sustained vowels and vibrato.
- Voiced/unvoiced decision should use **hysteresis** (a higher confidence to start a note, a lower one to stay in it) so notes don't flicker in and out.
- Restrict to a sensible vocal range (~55–1200 Hz).
- Run detection off the UI thread so the UI never stutters.
- One shared mic session across tabs; switching tabs must not kill or duplicate it.
- Respect the user's silence gate.

---

## 7. Gotchas from the first build (read these!)

### Microphone / audio input
- **Turn off echo cancellation, noise suppression, and auto-gain on the mic.** With these on (the platform default), the mic got gated whenever the app was playing a note — even with earphones on, because echo cancellation reacts to *any* audio output. Result: the tuner showed "—" during sequence playback. Raw mic fixed it instantly. Applies to every mic path (tuner, recording, calibration).
- Auto-gain also wrecks loudness readings and dynamics.
- **Tab switching killed the mic.** Leaving a tab stopped the mic; coming back, a delayed "mic ready" from the old tab arrived after the stop and left a stale listener attached, so the new tab never received pitch. Design the mic as a single app-level service with one subscriber hand-off, and make sure a pending mic start that resolves after a stop gets released.
- Mic permission and audio contexts may need to be started from a user tap on some platforms.

### Pitch detection
- Simple autocorrelation + zero-crossing + RMS gates compounded into constant false "silent" frames mid-note. Fewer, better gates beat many crude ones.
- Weighted smoothing on frequency = visible lag. User hated it. Use a short median for outlier rejection instead.
- A median over 2 values returns the larger one, not a median — biases readings upward right after silence. Use the raw value until the buffer is full.
- Nearest-semitone rounding flips between neighbors when the singer sits near the boundary. Color tolerance needs to be generous enough to not punish this.
- The key detector treats old and new notes equally, so it's slow to notice a key change; and a consistently flat singer can bias it toward the wrong key.

### UI readability
- Anything showing a live note must have a fixed size and fixed character positions. Resizing/shifting text = eye strain.
- Don't show cents on glanceable indicators; do show them on the precision tuner.
- The Play-tab tuner must sit next to the "Now Playing" label so the user can compare at a glance.
- Live-updating widgets ~20 times a second: only the pill/graph that changed should redraw, not the whole screen. The first build redrew everything every frame.

### Recording & playback
- The first ~50 ms of a recording often contains a click/silence from the recorder spinning up — trim it.
- Denoise after recording (offline), not live — live adds lag and the user plays the take back immediately anyway.
- Looping playback by watching the time and seeking back causes an audible stutter. Use a player with native gapless loop points.
- Release decoded audio of deleted/evicted takes, or memory grows.
- Recorded pitch and what the singer heard are offset by output+input latency — apply the calibrated offset when aligning.

### Persistence
- "Select last track" and bookmarks were in memory only, so they vanished on reload. Save the audio file itself plus per-track bookmarks and active loop. Large files can hit storage limits — handle failure gracefully.
- Latency offset and settings should also persist (they didn't).

### Process
- The dev server must be restarted after code changes for testing (hot reload was not reliable for the audio/JS side).
- Dead code piled up fast (unused cards, toggles, old persistence code). Delete superseded UI as you replace it — but don't delete half-wired features the user still wants (the persistence code got removed instead of finished).

---

## 8. Ideas considered but not built (optional backlog)

- Scoring modes for practice: pitch match, contour, intervals, streaks.
- Practice history across sessions (nailed notes over time, streaks).
- Installable/offline app.
- Graph camera that eases to follow the singer's range.
- Explicitly rejected: karaoke/song import, lyrics, multiplayer.
