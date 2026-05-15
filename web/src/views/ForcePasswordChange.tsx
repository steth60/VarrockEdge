import { useState, type FormEvent } from 'react';
import { Icon } from '../components/primitives';
import { api, ApiError } from '../api/client';

interface Props {
  /** Re-fetch the auth user once the password has been changed. */
  onDone: () => void | Promise<void>;
  onLogout: () => void;
}

// Shown after login while the account still carries must_change_password
// (the seeded admin). The server refuses every other API call until this
// completes, so this screen is the only way forward.
export function ForcePasswordChange({ onDone, onLogout }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) { setError('passwords do not match'); return; }
    if (newPassword.length < 12) { setError('password must be at least 12 characters'); return; }
    setPending(true);
    try {
      await api.patch('/api/auth/me', { currentPassword, newPassword });
      await onDone();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'could not change password');
    } finally {
      setPending(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400">{label}</span>
      <input
        type="password"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => set(e.target.value)}
        className="h-10 px-3 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400/60 focus:bg-zinc-900 transition-colors text-[13px] font-mono"
      />
    </label>
  );

  return (
    <div className="app-bg min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="relative w-10 h-10 rounded-lg flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg, #22d3ee, rgba(99,102,241,0.7))', boxShadow: '0 0 18px rgba(34,211,238,0.18)' }}>
            <Icon name="ShieldAlert" size={22} color="rgba(9,9,11,0.95)" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-display text-[20px] font-semibold tracking-tight">VarrokEdge</div>
            <div className="font-mono text-[11px] text-zinc-500">set a new password</div>
          </div>
        </div>
        <form onSubmit={submit} className="glass-strong rounded-2xl p-6 space-y-4 noise relative overflow-hidden">
          <h1 className="font-display text-[15px] font-semibold tracking-tight">Password change required</h1>
          <p className="text-[12px] text-zinc-400 leading-relaxed">
            This account still uses its install-time password. Choose a new one
            (at least 12 characters) to continue.
          </p>
          {field('Current password', currentPassword, setCurrentPassword, true)}
          {field('New password', newPassword, setNewPassword)}
          {field('Confirm new password', confirm, setConfirm)}
          {error && (
            <div className="text-[12px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={pending || !currentPassword || !newPassword || !confirm}
            className="w-full h-10 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-zinc-950 font-semibold text-[13px] accent-glow disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {pending ? 'Saving…' : 'Set password & continue'}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full h-9 rounded-lg text-[12px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
