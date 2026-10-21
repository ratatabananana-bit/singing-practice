import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Direction, ScaleId } from '../music/scales';
import { DEFAULT_TRACKER } from '../audio/pitch/tracker';

export type SoundMode = 'piano' | 'vocal' | 'flute';
export type IntroMode = 'off' | '15' | '135';
export type AutoAdvance = 'off' | 'up' | 'down';
export type TuneMode = 'note' | 'scale';
export type RangeEdge = 'turn' | 'stop' | 'continue';
export type PlayMode = 'along' | 'listen';
export type RunGap = 'none' | 'beat' | 'bar';

export interface PitchDebug {
  enabled: boolean;
  clarityOn: number;
  clarityOff: number;
  holdFrames: number;
  median: boolean;
  minFreq: number;
  maxFreq: number;
  k: number;
  /** Moving-average length for the Tune tab (frames). */
  tuneSmoothing: number;
  hopMs: number;
  /** Display-only smoothing of graph traces (0 = raw, 1 = light, 2 = heavy). Never affects tuning. */
  graphSmoothing: number;
}

export const DEFAULT_PITCH_DEBUG: PitchDebug = {
  enabled: true,
  clarityOn: DEFAULT_TRACKER.clarityOn,
  clarityOff: DEFAULT_TRACKER.clarityOff,
  holdFrames: DEFAULT_TRACKER.holdFrames,
  median: true,
  minFreq: 55,
  maxFreq: 1200,
  k: 0.9,
  tuneSmoothing: 3,
  hopMs: 25,
  graphSmoothing: 3,
};

export interface SettingsState {
  hiddenScales: ScaleId[];
  sound: SoundMode;
  intro: IntroMode;
  holdSeconds: number;
  silenceDb: number;
  /** Studio graph scroll speed in px per second. */
  graphSpeed: number;
  /** Daily goal in notes hit / nailed. */
  dailyGoal: number;
  /** Manual latency offset in ms (added to measured). */
  latencyOffsetMs: number;
  measuredLatencyMs: number | null;
  pitch: PitchDebug;
  autoPlayLastTake: boolean;
  /** Four clicks before recording starts. */
  countIn: boolean;
  denoise: boolean;
  /** "In tune" tolerance in cents (Tune tab); the Play pill allows 10 more. */
  toleranceCents: number;
  /** Vocal range limits (MIDI) used by auto-advance; null = unlimited. */
  rangeLow: number | null;
  rangeHigh: number | null;
  rangeEdge: RangeEdge;
  // Play tab
  playMode: PlayMode;
  runGap: RunGap;
  playRoot: number;
  playScale: ScaleId;
  playDirection: Direction;
  bpm: number;
  autoAdvance: AutoAdvance;
  // Tune tab
  tuneMode: TuneMode;
  tuneTarget: number;
  tuneScale: ScaleId;
  // Studio
  lastTrackId: string | null;
  studioExpanded: boolean;

  set: (p: Partial<SettingsState>) => void;
  setPitch: (p: Partial<PitchDebug>) => void;
  resetPitch: () => void;
  toggleScaleHidden: (id: ScaleId) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      hiddenScales: [],
      sound: 'piano',
      intro: '15',
      holdSeconds: 1.5,
      silenceDb: -50,
      graphSpeed: 60,
      dailyGoal: 50,
      latencyOffsetMs: 0,
      measuredLatencyMs: null,
      pitch: { ...DEFAULT_PITCH_DEBUG },
      autoPlayLastTake: true,
      countIn: true,
      denoise: false,
      toleranceCents: 20,
      rangeLow: null,
      rangeHigh: null,
      rangeEdge: 'turn',
      playMode: 'along',
      runGap: 'beat',
      playRoot: 60,
      playScale: 'major',
      playDirection: 'upDown',
      bpm: 120,
      autoAdvance: 'off',
      tuneMode: 'note',
      tuneTarget: 60,
      tuneScale: 'major',
      lastTrackId: null,
      studioExpanded: false,

      set: (p) => set(p),
      setPitch: (p) => set({ pitch: { ...get().pitch, ...p } }),
      resetPitch: () => set({ pitch: { ...DEFAULT_PITCH_DEBUG } }),
      toggleScaleHidden: (id) => {
        const hidden = get().hiddenScales;
        if (hidden.includes(id)) set({ hiddenScales: hidden.filter((h) => h !== id) });
        else set({ hiddenScales: [...hidden, id] });
      },
    }),
    {
      name: 'singing-practice-settings',
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as Partial<SettingsState>;
        if (version < 2 && s.pitch) {
          // v2: faster analysis rate and display smoothing; keep other debug values.
          s.pitch = { ...DEFAULT_PITCH_DEBUG, ...s.pitch, hopMs: s.pitch.hopMs === 50 ? 25 : s.pitch.hopMs, graphSmoothing: 3 };
        }
        return s as SettingsState;
      },
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { set: _s, setPitch: _sp, resetPitch: _rp, toggleScaleHidden: _t, ...rest } = s;
        return rest;
      },
    },
  ),
);

export function totalLatencyMs(s: Pick<SettingsState, 'latencyOffsetMs' | 'measuredLatencyMs'>): number {
  return (s.measuredLatencyMs ?? 0) + s.latencyOffsetMs;
}
