let ctx: AudioContext | null = null;

/** Shared AudioContext. Create lazily; call `unlockAudio()` from a user gesture. */
export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
  }
  return ctx;
}

export async function unlockAudio(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      /* will retry on next gesture */
    }
  }
  return c;
}

export function audioNow(): number {
  return ctx ? ctx.currentTime : 0;
}

const loaded = new Map<string, Promise<void>>();
export function loadWorklet(url: string): Promise<void> {
  const c = getAudioContext();
  let p = loaded.get(url);
  if (!p) {
    p = c.audioWorklet.addModule(url);
    loaded.set(url, p);
    p.catch(() => loaded.delete(url));
  }
  return p;
}
