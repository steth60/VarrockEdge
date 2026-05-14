import { useEffect, useState } from 'react';

export interface Tweaks {
  accent: 'cyan' | 'indigo' | 'violet' | 'emerald';
  density: 'compact' | 'regular' | 'comfy';
  fxGlass: boolean;
  monoFont: 'JetBrains Mono' | 'IBM Plex Mono' | 'Fira Code' | 'ui-monospace';
}

const DEFAULTS: Tweaks = {
  accent: 'cyan',
  density: 'regular',
  fxGlass: true,
  monoFont: 'JetBrains Mono',
};

const KEY = 've.tweaks';

export const ACCENT_PALETTE = {
  cyan:    { name: 'Cyan',    hex: '#22d3ee', soft: 'rgba(34,211,238,0.18)' },
  indigo:  { name: 'Indigo',  hex: '#818cf8', soft: 'rgba(129,140,248,0.20)' },
  violet:  { name: 'Violet',  hex: '#a78bfa', soft: 'rgba(167,139,250,0.20)' },
  emerald: { name: 'Emerald', hex: '#34d399', soft: 'rgba(52,211,153,0.20)' },
} as const;

export function useTweaks() {
  const [tweaks, setTweaks] = useState<Tweaks>(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return DEFAULTS;
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(tweaks)); } catch { /* ignore */ }
    const accent = ACCENT_PALETTE[tweaks.accent];
    document.documentElement.style.setProperty('--accent', accent.hex);
    document.documentElement.style.setProperty('--accent-soft', accent.soft);
  }, [tweaks]);

  const setTweak = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) =>
    setTweaks(prev => ({ ...prev, [k]: v }));

  return { tweaks, setTweak };
}
