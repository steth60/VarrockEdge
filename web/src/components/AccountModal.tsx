import { useEffect, useState } from 'react';
import { Modal, Field, Input, Button, Icon, Badge } from './primitives';
import { api } from '../api/client';
import type { AuthUser } from '../hooks/useAuth';

function Notice({ kind, msg }: { kind: 'error' | 'ok'; msg: string }) {
  const cls = kind === 'error'
    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
    : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300';
  return (
    <div className={`mt-3 p-2.5 rounded-lg border text-[11.5px] flex gap-1.5 ${cls}`}>
      <Icon name={kind === 'error' ? 'AlertCircle' : 'CheckCircle2'} size={13} className="shrink-0 mt-0.5" />{msg}
    </div>
  );
}

export function AccountModal({
  open, onClose, user, onSaved,
}: { open: boolean; onClose: () => void; user: AuthUser; onSaved: () => void }) {
  // Profile
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [profilePw, setProfilePw] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: 'error' | 'ok'; msg: string } | null>(null);
  // Password
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: 'error' | 'ok'; msg: string } | null>(null);

  // Reset to the current user whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setName(user.name); setEmail(user.email); setProfilePw('');
      setCurPw(''); setNewPw(''); setConfirmPw('');
      setProfileMsg(null); setPwMsg(null);
    }
  }, [open, user]);

  const emailChanged = email.trim() !== user.email;
  const nameChanged = name.trim() !== user.name;

  const saveProfile = async () => {
    setProfileMsg(null);
    if (!name.trim()) { setProfileMsg({ kind: 'error', msg: 'Name cannot be empty.' }); return; }
    if (!nameChanged && !emailChanged) { setProfileMsg({ kind: 'error', msg: 'Nothing changed.' }); return; }
    if (emailChanged && !profilePw) { setProfileMsg({ kind: 'error', msg: 'Enter your current password to change your email.' }); return; }
    setProfileBusy(true);
    const body: Record<string, string> = {};
    if (nameChanged) body.name = name.trim();
    if (emailChanged) { body.email = email.trim(); body.currentPassword = profilePw; }
    try {
      await api.patch('/api/auth/me', body);
      setProfileMsg({ kind: 'ok', msg: 'Profile updated.' });
      setProfilePw('');
      onSaved();
    } catch (e: any) {
      setProfileMsg({ kind: 'error', msg: e?.message ?? 'Update failed.' });
    } finally { setProfileBusy(false); }
  };

  const savePassword = async () => {
    setPwMsg(null);
    if (!curPw || !newPw) { setPwMsg({ kind: 'error', msg: 'Fill in all password fields.' }); return; }
    if (newPw.length < 8) { setPwMsg({ kind: 'error', msg: 'New password must be at least 8 characters.' }); return; }
    if (newPw !== confirmPw) { setPwMsg({ kind: 'error', msg: 'New password and confirmation do not match.' }); return; }
    setPwBusy(true);
    try {
      await api.patch('/api/auth/me', { currentPassword: curPw, newPassword: newPw });
      setPwMsg({ kind: 'ok', msg: 'Password changed.' });
      setCurPw(''); setNewPw(''); setConfirmPw('');
      onSaved();
    } catch (e: any) {
      setPwMsg({ kind: 'error', msg: e?.message ?? 'Password change failed.' });
    } finally { setPwBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Account settings" subtitle={`Signed in as ${user.email}`} size="md"
           footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-6">
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Icon name="UserCog" size={14} className="text-cyan-300" />
            <h4 className="font-display text-[13px] font-semibold text-zinc-100">Profile</h4>
            <Badge variant="neutral" size="sm">{user.role}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input mono value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {emailChanged && (
              <Field label="Current password" hint="Required to change your email" className="md:col-span-2">
                <Input type="password" value={profilePw} onChange={(e) => setProfilePw(e.target.value)} />
              </Field>
            )}
          </div>
          {profileMsg && <Notice kind={profileMsg.kind} msg={profileMsg.msg} />}
          <div className="mt-3 flex justify-end">
            <Button variant="primary" icon="Save" onClick={saveProfile} disabled={profileBusy || (!nameChanged && !emailChanged)}>
              {profileBusy ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </section>

        <section className="pt-5 border-t border-zinc-800/60">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="KeyRound" size={14} className="text-cyan-300" />
            <h4 className="font-display text-[13px] font-semibold text-zinc-100">Change password</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Current password">
              <Input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            </Field>
            <Field label="New password" hint="Min 8 characters">
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </Field>
          </div>
          {pwMsg && <Notice kind={pwMsg.kind} msg={pwMsg.msg} />}
          <div className="mt-3 flex justify-end">
            <Button variant="primary" icon="Save" onClick={savePassword} disabled={pwBusy || !curPw || !newPw}>
              {pwBusy ? 'Saving…' : 'Change password'}
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
