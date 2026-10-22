import { useEffect, useState } from 'react';

export const TABLET_QUERY = '(min-width: 600px)';

/** True on tablet-width screens (matches the CSS breakpoint in global.css). */
export function useTablet(): boolean {
  const [t, setT] = useState(() => typeof window !== 'undefined' && window.matchMedia(TABLET_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(TABLET_QUERY);
    const on = () => setT(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return t;
}
