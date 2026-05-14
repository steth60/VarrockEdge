import React, { type ComponentProps, type ReactNode, useId } from 'react';
import * as LucideIcons from 'lucide-react';

// ─────────────────────────────────────────────────────────────────
// Icon — looks up a Lucide icon by name
// ─────────────────────────────────────────────────────────────────
type LucideKey = keyof typeof LucideIcons;

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, color, strokeWidth = 1.75, className = '' }: IconProps) {
  const Comp = (LucideIcons as any)[name] ?? (LucideIcons as any).Circle;
  return (
    <Comp
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={`shrink-0 ${className}`}
      aria-hidden
    />
  );
}

// ─────────────────────────────────────────────────────────────────
// Badge
// ─────────────────────────────────────────────────────────────────
const BADGE_VARIANTS = {
  success: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25',
  danger:  'text-rose-300 bg-rose-400/10 border-rose-400/25',
  warn:    'text-amber-300 bg-amber-400/10 border-amber-400/25',
  info:    'text-sky-300 bg-sky-400/10 border-sky-400/25',
  neutral: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/25',
  accent:  'text-cyan-300 bg-cyan-400/10 border-cyan-400/25',
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

export function Badge({
  variant = 'neutral', size = 'sm', icon, children,
}: { variant?: BadgeVariant; size?: 'sm' | 'md'; icon?: string; children: ReactNode }) {
  const sizes = { sm: 'text-[10.5px] px-2 py-[3px] gap-1.5', md: 'text-xs px-2.5 py-1 gap-1.5' };
  return (
    <span className={`inline-flex items-center rounded-full border font-medium tracking-tight ${BADGE_VARIANTS[variant]} ${sizes[size]}`}>
      {icon && <Icon name={icon} size={size === 'md' ? 12 : 11} strokeWidth={2} />}
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// StatusPill
// ─────────────────────────────────────────────────────────────────
const STATUS_PILL = {
  running:  { dot: 'bg-emerald-400 dot-pulse', text: 'text-emerald-300', label: 'Running'  },
  stopped:  { dot: 'bg-rose-400',              text: 'text-rose-300',    label: 'Stopped'  },
  degraded: { dot: 'bg-amber-400',             text: 'text-amber-300',   label: 'Degraded' },
} as const;

export type StatusKind = keyof typeof STATUS_PILL;

export function StatusPill({ status, label }: { status: StatusKind; label?: string }) {
  const s = STATUS_PILL[status];
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium tracking-tight">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className={s.text}>{label ?? s.label}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────
const BTN_VARIANTS = {
  primary:   'bg-cyan-400 text-zinc-950 hover:bg-cyan-300 accent-glow font-semibold',
  secondary: 'bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700/80 border border-zinc-700/70',
  ghost:     'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60',
  danger:    'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30',
  outline:   'border border-zinc-700/70 text-zinc-200 hover:bg-zinc-800/60',
} as const;

export type ButtonVariant = keyof typeof BTN_VARIANTS;

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'type'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: string;
  iconRight?: string;
  type?: 'button' | 'submit' | 'reset';
}

export function Button({
  variant = 'secondary', size = 'md', icon, iconRight, children, className = '', type = 'button', ...rest
}: ButtonProps) {
  const sizes = { sm: 'h-7 px-2.5 text-[11.5px] gap-1.5 rounded-md', md: 'h-9 px-3.5 text-[12.5px] gap-2 rounded-lg' };
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center font-medium tracking-tight transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${BTN_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} strokeWidth={2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 12 : 14} strokeWidth={2} />}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// IconButton
// ─────────────────────────────────────────────────────────────────
export function IconButton({
  name, label, variant = 'ghost', size = 'md', onClick, className = '',
}: { name: string; label: string; variant?: ButtonVariant; size?: 'sm' | 'md'; onClick?: () => void; className?: string }) {
  const sizes = { sm: 'w-7 h-7 rounded-md', md: 'w-9 h-9 rounded-lg' };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex items-center justify-center transition-colors ${sizes[size]} ${BTN_VARIANTS[variant]} ${className}`}
    >
      <Icon name={name} size={size === 'sm' ? 13 : 15} strokeWidth={1.75} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────
export function Card({
  title, subtitle, action, children, className = '', padding = 'p-5',
}: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padding?: string }) {
  return (
    <section className={`relative glass rounded-xl noise overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            {title && <h3 className="font-display text-[13.5px] font-semibold tracking-tight text-zinc-100">{title}</h3>}
            {subtitle && <p className="text-[11.5px] text-zinc-500 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={title ? 'px-5 pb-5' : padding}>{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Form primitives
// ─────────────────────────────────────────────────────────────────
export function Field({
  label, hint, children, className = '',
}: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, ComponentProps<'input'> & { mono?: boolean }>(
  function Input({ mono, className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`h-9 px-3 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-zinc-100 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-cyan-400/60 focus:bg-zinc-900 transition-colors text-[12.5px] ${mono ? 'font-mono' : ''} ${className}`}
        {...rest}
      />
    );
  }
);

export function Select({ children, className = '', ...rest }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={`h-9 pl-3 pr-8 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-zinc-100 hover:border-zinc-600 focus:border-cyan-400/60 transition-colors text-[12.5px] appearance-none w-full ${className}`}
        {...rest}
      >
        {children}
      </select>
      <Icon name="ChevronDown" size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// KPICard
// ─────────────────────────────────────────────────────────────────
export function KPICard({
  label, value, unit, trend, spark, icon, tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  trend?: { dir: 'up' | 'down'; value: string };
  spark?: ReactNode;
  icon?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
}) {
  const toneColors = {
    neutral: 'text-zinc-100',
    accent:  'text-cyan-300',
    success: 'text-emerald-300',
    danger:  'text-rose-300',
  };
  return (
    <div className="relative glass rounded-xl noise overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-zinc-400">
          {icon && <Icon name={icon} size={13} className="text-zinc-500" />}
          <span className="text-[11px] uppercase tracking-[0.08em] font-medium">{label}</span>
        </div>
        {trend && (
          <span className={`text-[10.5px] font-mono ${trend.dir === 'up' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {trend.dir === 'up' ? '▲' : '▼'} {trend.value}
          </span>
        )}
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className={`font-display text-[34px] leading-none font-semibold tracking-tight ${toneColors[tone]}`}>{value}</span>
        {unit && <span className="text-[12px] text-zinc-500 font-mono">{unit}</span>}
      </div>
      {spark}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────────────────
export function Sparkline({
  data, color = '#22d3ee', height = 36, fill = true,
}: { data: number[]; color?: string; height?: number; fill?: boolean }) {
  const w = 100;
  const h = height;
  const gradId = useId();
  if (!data || !data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - 4 - ((v - min) / span) * (h - 8);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full mt-3" style={{ height }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradId})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// Ring meter
// ─────────────────────────────────────────────────────────────────
export function Ring({
  value, size = 64, color = '#22d3ee', label,
}: { value: number; size?: number; color?: string; label?: string }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(63,63,70,0.5)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[11px] text-zinc-200">{label ?? `${Math.round(value)}%`}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────
export function Modal({
  open, onClose, title, subtitle, size = 'md', children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm overlay-in" onClick={onClose} />
      <div className={`relative w-full ${sizes[size]} glass-strong rounded-2xl modal-in overflow-hidden`}>
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-zinc-800/70">
          <div>
            {title && <h3 className="font-display text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h3>}
            {subtitle && <p className="text-[12px] text-zinc-500 mt-0.5">{subtitle}</p>}
          </div>
          <IconButton name="X" label="Close" onClick={onClose} size="sm" />
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && <footer className="px-6 py-4 border-t border-zinc-800/70 bg-zinc-900/40 flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared small components
// ─────────────────────────────────────────────────────────────────
export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">{k}</div>
      <div className={`text-zinc-200 mt-0.5 ${mono ? 'font-mono text-[12px]' : 'text-[12.5px]'}`}>{v}</div>
    </div>
  );
}

export function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-cyan-400' : 'bg-zinc-700'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-zinc-950 transition-transform ${value ? 'translate-x-4' : ''}`} />
    </button>
  );
}

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-6 py-4 border-b border-zinc-800/60 last:border-b-0">
      <div className="md:w-64 shrink-0">
        <div className="text-[12.5px] font-medium text-zinc-200">{label}</div>
        {hint && <div className="text-[11.5px] text-zinc-500 mt-1 leading-relaxed">{hint}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-zinc-300">{label}</span>
    </span>
  );
}

export function Avatar({ name, colors, size = 32 }: { name: string; colors: [string, string]; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="rounded-full flex items-center justify-center font-semibold text-zinc-950 shrink-0"
          style={{
            width: size, height: size,
            background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
            fontSize: size * 0.36,
          }}>{initials}</span>
  );
}

export const LOG_LEVEL_COLORS: Record<string, string> = {
  INFO:  'text-sky-300',
  WARN:  'text-amber-300',
  ERROR: 'text-rose-300',
  DEBUG: 'text-zinc-500',
  OK:    'text-emerald-300',
};

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
export function makeWave(n: number, center: number, amp: number) {
  return Array.from({ length: n }, (_, i) =>
    center + Math.sin(i * 0.42) * amp * 0.6 + (Math.random() - 0.5) * amp);
}
export function shift<T>(arr: T[], v: T): T[] { return [...arr.slice(1), v]; }
