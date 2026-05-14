import { useState } from 'react';
import { Icon } from './primitives';
import { ACCENT_PALETTE, type Tweaks } from '../hooks/useTweaks';

interface Props {
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
}

export function TweaksPanel({ tweaks, setTweak }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 h-9 px-3 rounded-lg glass-strong text-zinc-200 hover:text-zinc-100 text-[12px]"
        title="Tweaks"
      >
        <Icon name="Sparkles" size={14} className="text-cyan-300" />
        Tweaks
      </button>
      {open && (
        <div className="fixed bottom-16 right-4 z-40 w-72 glass-strong rounded-2xl p-4 space-y-4 modal-in">
          <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Accent</div>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(ACCENT_PALETTE) as Array<keyof typeof ACCENT_PALETTE>).map(k => (
              <button
                key={k}
                onClick={() => setTweak('accent', k)}
                className={`h-9 rounded-md border ${tweaks.accent === k ? 'border-zinc-100' : 'border-zinc-700/70'} text-[10.5px] font-mono capitalize`}
                style={{ background: ACCENT_PALETTE[k].soft, color: ACCENT_PALETTE[k].hex }}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">Density</div>
          <div className="inline-flex w-full rounded-lg bg-zinc-900/60 border border-zinc-800/60 p-1">
            {(['compact', 'regular', 'comfy'] as const).map(d => (
              <button
                key={d}
                onClick={() => setTweak('density', d)}
                className={`flex-1 px-2 h-7 text-[11.5px] rounded-md font-medium transition-colors ${tweaks.density === d ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">FX</div>
          <label className="flex items-center justify-between text-[12.5px]">
            <span>Glass effects</span>
            <button
              type="button"
              role="switch"
              aria-checked={tweaks.fxGlass}
              onClick={() => setTweak('fxGlass', !tweaks.fxGlass)}
              className={`relative w-9 h-5 rounded-full transition-colors ${tweaks.fxGlass ? 'bg-cyan-400' : 'bg-zinc-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-zinc-950 transition-transform ${tweaks.fxGlass ? 'translate-x-4' : ''}`} />
            </button>
          </label>
        </div>
      )}
    </>
  );
}
