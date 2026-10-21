import { useEffect, useState } from 'react';
import { PlayTab } from './tabs/PlayTab';
import { TuneTab } from './tabs/TuneTab';
import { StudioTab } from './tabs/StudioTab';
import { SettingsSheet } from './components/SettingsSheet';
import { mic } from './audio/mic/MicService';
import { unlockAudio } from './audio/context';
import { useMicState } from './state/pitchStore';
import { useSettings } from './state/settings';
import { instrument } from './audio/synth/Instrument';
import './state/pitchHistory';

type Tab = 'play' | 'tune' | 'studio';

const TABS: { id: Tab; name: string; sub: string }[] = [
  { id: 'play', name: 'Play', sub: 'Scales & arpeggios' },
  { id: 'tune', name: 'Tune', sub: 'Vocal tuner' },
  { id: 'studio', name: 'Studio', sub: 'Track & takes' },
];

export function App() {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('tab') as Tab) || 'play');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state: micState, error: micError } = useMicState();

  useEffect(() => {
    localStorage.setItem('tab', tab);
  }, [tab]);

  // Mic permission and audio contexts need a user gesture on some platforms:
  // start both on the first tap anywhere.
  useEffect(() => {
    const onFirst = (e: PointerEvent) => {
      void unlockAudio();
      // The LIVE/PAUSED pill handles the mic itself; starting it here too would make
      // that first tap start-then-pause.
      const onMicPill = (e.target as HTMLElement | null)?.closest?.('[data-mic-toggle]');
      if (mic.state === 'idle' && !onMicPill) void mic.start();
      if (useSettings.getState().sound === 'piano') instrument.preloadAll();
      window.removeEventListener('pointerdown', onFirst);
    };
    window.addEventListener('pointerdown', onFirst);
    return () => window.removeEventListener('pointerdown', onFirst);
  }, []);

  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{cur.name}</h1>
          <div className="sub">{cur.sub}</div>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <GearIcon />
        </button>
      </header>
      <main className="content">
        {micState === 'error' && (
          <div className="banner bad toast" onClick={() => void mic.start()}>
            Mic unavailable: {micError}. Tap to retry.
          </div>
        )}
        {micState === 'idle' && <div className="banner toast">Tap anywhere to enable the microphone.</div>}
        {tab === 'play' && <PlayTab />}
        {tab === 'tune' && <TuneTab />}
        {tab === 'studio' && <StudioTab />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            <TabIcon id={t.id} />
            {t.name}
          </button>
        ))}
      </nav>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function TabIcon({ id }: { id: Tab }) {
  if (id === 'play')
    return (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  if (id === 'tune')
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 12h3l3-7 4 14 3-7h5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
