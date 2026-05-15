import { useEffect, useRef, useState } from 'react';
import { Card, Button, Badge, Icon } from './primitives';
import { api } from '../api/client';

interface SpeedResult {
  downloadMbps: number; uploadMbps: number; pingMs: number;
  isp: string | null; server: string | null; ts: number; source: 'ookla' | 'synthetic';
}
interface SpeedEvent {
  phase: 'ping' | 'download' | 'upload' | 'done' | 'error';
  mbps?: number; pingMs?: number; elapsed?: number; result?: SpeedResult; msg?: string;
}
interface HistoryRun {
  id: number; ts: number; downloadMbps: number; uploadMbps: number; pingMs: number;
  isp: string | null; server: string | null; source: string; trigger: string;
}

function timeAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

/** Combined download/upload sample graph during a run. */
function RunGraph({ down, up }: { down: number[]; up: number[] }) {
  const all = [...down, ...up];
  const max = Math.max(1, ...all) * 1.1;
  const W = 600, H = 120;
  const line = (xs: number[], color: string) => {
    if (xs.length < 2) return null;
    const pts = xs.map((v, i) => `${(i / (xs.length - 1)) * W},${H - (v / max) * H}`).join(' ');
    return <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
  };
  return (
    <div className="w-full h-[120px]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
        {line(down, '#34d399')}
        {line(up, '#22d3ee')}
      </svg>
    </div>
  );
}

/**
 * Full-width speed-test "mainview" — larger than the NOC-rail card. Streams
 * the run over SSE from /api/probes/speedtest/stream and shows recent history.
 */
export function SpeedTestMainView() {
  const [phase, setPhase] = useState<'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error'>('idle');
  const [down, setDown] = useState<number[]>([]);
  const [up, setUp] = useState<number[]>([]);
  const [livePing, setLivePing] = useState<number | null>(null);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const loadHistory = () => api.get<{ runs: HistoryRun[] }>('/api/probes/speedtest/history?limit=12')
    .then(r => setRuns(r.runs)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => () => { esRef.current?.close(); }, []);

  const start = () => {
    if (phase === 'ping' || phase === 'download' || phase === 'upload') return;
    setDown([]); setUp([]); setLivePing(null); setResult(null); setProgress(0); setPhase('ping');
    const es = new EventSource('/api/probes/speedtest/stream', { withCredentials: true });
    esRef.current = es;
    es.onmessage = (m) => {
      try {
        const ev: SpeedEvent = JSON.parse(m.data);
        if (ev.phase === 'ping') {
          setPhase('ping');
          if (ev.pingMs !== undefined) setLivePing(ev.pingMs);
        } else if (ev.phase === 'download') {
          setPhase('download');
          if (ev.mbps !== undefined) setDown(s => [...s, ev.mbps!]);
        } else if (ev.phase === 'upload') {
          setPhase('upload');
          if (ev.mbps !== undefined) setUp(s => [...s, ev.mbps!]);
        } else if (ev.phase === 'done' && ev.result) {
          setPhase('done'); setResult(ev.result); setProgress(1); loadHistory(); es.close();
        } else if (ev.phase === 'error') {
          setPhase('error'); es.close();
        }
        if (ev.elapsed !== undefined) setProgress(ev.elapsed);
      } catch { /* ignore */ }
    };
    es.onerror = () => { setPhase(p => (p === 'done' ? p : 'error')); es.close(); };
  };

  const running = phase === 'ping' || phase === 'download' || phase === 'upload';
  const lastDown = down[down.length - 1] ?? 0;
  const lastUp = up[up.length - 1] ?? 0;
  const last = runs[0];

  // What the big readout shows: live during a run, the result when done, else last history run.
  const readout = phase === 'done' && result
    ? { d: result.downloadMbps, u: result.uploadMbps, p: result.pingMs }
    : running
    ? { d: lastDown, u: lastUp, p: livePing ?? 0 }
    : last
    ? { d: last.downloadMbps, u: last.uploadMbps, p: last.pingMs }
    : null;

  return (
    <Card title="ISP speed test" subtitle="Ookla-backed throughput test · auto-runs at 00:00 and 12:00 daily"
          action={<Button variant="primary" size="sm" icon="Gauge" onClick={start} disabled={running}>
            {running ? 'Running…' : phase === 'done' || phase === 'error' ? 'Run again' : 'Run speed test'}
          </Button>}>
      <div className="grid grid-cols-3 gap-4">
        {[
          { k: 'Download', v: readout?.d, unit: 'Mbps', color: 'text-emerald-300' },
          { k: 'Upload',   v: readout?.u, unit: 'Mbps', color: 'text-cyan-300' },
          { k: 'Ping',     v: readout?.p, unit: 'ms',   color: 'text-zinc-100' },
        ].map(c => (
          <div key={c.k} className="rounded-lg bg-zinc-900/40 border border-zinc-800/60 p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">{c.k}</div>
            <div className={`font-mono text-[30px] leading-none mt-2 ${readout ? c.color : 'text-zinc-700'}`}>
              {readout && c.v !== undefined ? (c.unit === 'ms' ? c.v.toFixed(0) : c.v.toFixed(1)) : '—'}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{c.unit}{phase === 'done' && c.unit === 'Mbps' ? ' avg' : ''}</div>
          </div>
        ))}
      </div>

      {(running || phase === 'done') && (down.length > 0 || up.length > 0) && (
        <div className="mt-4"><RunGraph down={down} up={up} /></div>
      )}

      {running && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-[10.5px] text-zinc-500">
            <span>{phase === 'ping' ? 'Latency probe' : phase === 'download' ? 'Download · ~30s' : 'Upload · ~30s'}</span>
            <span className="font-mono">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full rounded-full transition-all"
                 style={{ width: `${Math.max(2, progress * 100)}%`, background: phase === 'upload' ? '#22d3ee' : '#34d399' }} />
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="mt-3 text-[11.5px] text-rose-300 flex items-center gap-1.5">
          <Icon name="AlertCircle" size={13} /> Speed test failed — check the WAN link and try again.
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-zinc-800/60">
        <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Recent tests</div>
        {runs.length === 0 ? (
          <div className="text-[11.5px] text-zinc-600 py-2">no runs recorded yet</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                <th className="font-medium py-1.5">When</th>
                <th className="font-medium py-1.5 text-right">Down</th>
                <th className="font-medium py-1.5 text-right">Up</th>
                <th className="font-medium py-1.5 text-right">Ping</th>
                <th className="font-medium py-1.5 pl-3">Source</th>
                <th className="font-medium py-1.5 pl-2">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {runs.map(r => (
                <tr key={r.id} className="hover:bg-zinc-900/30">
                  <td className="py-1.5 font-mono text-zinc-400" title={new Date(r.ts).toISOString()}>{timeAgo(r.ts)}</td>
                  <td className="py-1.5 text-right font-mono text-emerald-300">{r.downloadMbps.toFixed(1)}</td>
                  <td className="py-1.5 text-right font-mono text-cyan-300">{r.uploadMbps.toFixed(1)}</td>
                  <td className="py-1.5 text-right font-mono text-zinc-100">{r.pingMs.toFixed(0)}</td>
                  <td className="py-1.5 pl-3"><Badge variant={r.source === 'ookla' ? 'success' : 'warn'} size="sm">{r.source}</Badge></td>
                  <td className="py-1.5 pl-2"><Badge variant={r.trigger === 'scheduled' ? 'info' : 'neutral'} size="sm">{r.trigger}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
