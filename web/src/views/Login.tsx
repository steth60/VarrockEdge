import { useState, type FormEvent } from 'react';
import { Icon } from '../components/primitives';

interface Props {
  onLogin: (email: string, password: string) => Promise<unknown>;
}

export function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('admin@varrok.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err?.message ?? 'login failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="app-bg min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="relative w-10 h-10 rounded-lg flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg, #22d3ee, rgba(99,102,241,0.7))', boxShadow: '0 0 18px rgba(34,211,238,0.18)' }}>
            <Icon name="Hexagon" size={22} color="rgba(9,9,11,0.95)" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-display text-[20px] font-semibold tracking-tight">VarrokEdge</div>
            <div className="font-mono text-[11px] text-zinc-500">control plane</div>
          </div>
        </div>
        <form onSubmit={submit} className="glass-strong rounded-2xl p-6 space-y-4 noise relative overflow-hidden">
          <h1 className="font-display text-[15px] font-semibold tracking-tight">Sign in</h1>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="h-10 px-3 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400/60 focus:bg-zinc-900 transition-colors text-[13px]"
              placeholder="admin@varrok.local"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 px-3 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400/60 focus:bg-zinc-900 transition-colors text-[13px] font-mono"
            />
          </label>
          {error && (
            <div className="text-[12px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={pending || !password}
            className="w-full h-10 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-zinc-950 font-semibold text-[13px] accent-glow disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-[11px] text-zinc-500 leading-relaxed pt-1">
            VarrokEdge binds to the LAN only. If you can read this, your network ACLs are working.
          </p>
        </form>
      </div>
    </div>
  );
}
