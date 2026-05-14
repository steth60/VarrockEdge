import { useEffect, useState } from 'react';
import { Card, Button, IconButton, Badge, KPICard, Avatar, Icon, Modal, Field, Input, Select } from '../components/primitives';
import { api } from '../api/client';

interface U { id: number; email: string; name: string; role: string; status: string; mfaEnabled: boolean; lastSeenAt: string | null; createdAt: string }

const ROLES = [
  { name: 'Owner',     desc: 'Full control including billing and account deletion. Only one allowed.',         color: 'accent' as const },
  { name: 'Admin',     desc: 'Manage all subsystems and users. Cannot delete the account.',                    color: 'info' as const },
  { name: 'Network',   desc: 'Edit DHCP/DNS/Firewall/WireGuard. No user or billing access.',                    color: 'success' as const },
  { name: 'Read-only', desc: 'View dashboards and logs. No mutations.',                                         color: 'neutral' as const },
];

const AVATAR_COLORS: Array<[string, string]> = [
  ['#22d3ee', '#6366f1'], ['#34d399', '#22d3ee'], ['#a78bfa', '#6366f1'],
  ['#fb923c', '#f43f5e'], ['#facc15', '#fb923c'], ['#71717a', '#52525b'],
];

export function Users() {
  const [tab, setTab] = useState<'members' | 'roles' | 'sessions' | 'audit'>('members');
  const [users, setUsers] = useState<U[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'Read-only', password: '' });

  const reload = () => { api.get<{ users: U[] }>('/api/users').then(r => setUsers(r.users)).catch(() => {}); };
  useEffect(reload, []);

  const sendInvite = async () => {
    if (!invite.email || !invite.password) return;
    try {
      await api.post('/api/users', invite);
      setInvite({ email: '', name: '', role: 'Read-only', password: '' });
      setInviteOpen(false);
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const counts = {
    active:    users.filter(u => u.status === 'active').length,
    invited:   users.filter(u => u.status === 'invited').length,
    suspended: users.filter(u => u.status === 'suspended').length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard label="Active members"  value={counts.active}   icon="Users"        tone="neutral" />
        <KPICard label="Pending invites" value={counts.invited}  icon="MailQuestion" tone="accent" />
        <KPICard label="Suspended"       value={counts.suspended} icon="UserX"        tone="danger" />
        <KPICard label="MFA coverage"    value={users.length ? `${Math.round(users.filter(u => u.mfaEnabled).length / users.length * 100)}` : '0'} unit="%" icon="ShieldCheck" tone="success" />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60 w-fit">
          {[
            { id: 'members',  label: 'Members',         icon: 'Users' },
            { id: 'roles',    label: 'Roles',           icon: 'Tag' },
            { id: 'sessions', label: 'Active sessions', icon: 'Activity' },
            { id: 'audit',    label: 'Audit log',       icon: 'ScrollText' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
                    className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${tab === t.id ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
              <Icon name={t.icon} size={13} />{t.label}
            </button>
          ))}
        </div>
        {tab === 'members' && <Button variant="primary" size="md" icon="UserPlus" onClick={() => setInviteOpen(true)}>Invite member</Button>}
      </div>

      {tab === 'members' && (
        <Card title="Members" subtitle={`${users.length} accounts`}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                <th className="font-medium py-2.5">User</th><th className="font-medium py-2.5">Role</th>
                <th className="font-medium py-2.5">Status</th><th className="font-medium py-2.5">MFA</th>
                <th className="font-medium py-2.5">Last seen</th><th className="font-medium py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {users.map((u, i) => (
                <tr key={u.id} className="hover:bg-zinc-900/30 group">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} colors={AVATAR_COLORS[i % AVATAR_COLORS.length]!} />
                      <div>
                        <div className="text-zinc-100">{u.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    <Badge variant={u.role === 'Owner' ? 'accent' : u.role === 'Admin' ? 'info' : u.role === 'Network' ? 'success' : 'neutral'} size="sm">{u.role}</Badge>
                  </td>
                  <td className="py-3">
                    <Badge variant={u.status === 'active' ? 'success' : u.status === 'invited' ? 'warn' : 'danger'} size="sm">{u.status}</Badge>
                  </td>
                  <td className="py-3">
                    {u.mfaEnabled
                      ? <span className="inline-flex items-center gap-1.5 text-emerald-300 text-[11.5px]"><Icon name="ShieldCheck" size={12} />enabled</span>
                      : <span className="inline-flex items-center gap-1.5 text-rose-300 text-[11.5px]"><Icon name="ShieldOff" size={12} />off</span>}
                  </td>
                  <td className="py-3 text-zinc-400">{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : 'never'}</td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconButton name="Pencil" label="Edit" size="sm" />
                      <IconButton name="KeyRound" label="Reset password" size="sm" />
                      <IconButton name="Trash2" label="Remove" size="sm" variant="danger"
                        onClick={() => api.delete(`/api/users/${u.id}`).then(reload).catch(err => alert(err?.message))} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'roles' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ROLES.map(r => (
            <Card key={r.name} title={r.name} subtitle={r.desc}
                  action={<Badge variant={r.color} size="sm">{r.name === 'Owner' ? 'system' : 'editable'}</Badge>}>
              <div className="divider mt-1 pt-3 flex justify-between text-[11.5px] text-zinc-400">
                <span>{users.filter(u => u.role === r.name).length} members</span>
                <button className="text-cyan-300 hover:text-cyan-200">Manage →</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'sessions' && <SessionsPanel />}

      {tab === 'audit' && (
        <Card title="Audit Log" subtitle="User actions — last 200 events">
          <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11.5px] leading-relaxed max-h-[420px] overflow-auto">
            {[
              ['14:18:02', 'admin',  'firewall.dnat.add',      'eth0:2222 → 10.0.0.10:22'],
              ['14:11:44', 'admin',  'wireguard.peer.connect', 'site-londonB'],
              ['13:40:09', 'admin',  'auth.login.success',     '88.214.10.92'],
            ].map(([t, u, action, detail], i) => (
              <div key={i} className="flex gap-3">
                <span className="text-zinc-600 shrink-0">{t}</span>
                <span className="text-zinc-300 shrink-0 w-16">{u}</span>
                <span className="text-cyan-300 shrink-0 w-44">{action}</span>
                <span className="text-zinc-500 truncate">{detail}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a member"
             footer={
               <>
                 <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
                 <Button variant="primary" icon="Send" onClick={sendInvite}>Send invite</Button>
               </>
             }>
        <div className="space-y-4">
          <Field label="Email"><Input placeholder="name@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          <Field label="Name (optional)"><Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {ROLES.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Initial password" hint="They'll be prompted to change it on first sign-in.">
            <Input type="password" value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function SessionsPanel() {
  const [sess, setSess] = useState<any[]>([]);
  useEffect(() => {
    api.get<{ sessions: any[] }>('/api/users/sessions/active').then(r => setSess(r.sessions)).catch(() => {});
  }, []);
  return (
    <Card title="Active Sessions" subtitle="Currently authenticated browsers and tokens">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <th className="font-medium py-2.5">User</th>
            <th className="font-medium py-2.5">Source</th>
            <th className="font-medium py-2.5">Client</th>
            <th className="font-medium py-2.5">Started</th>
            <th className="font-medium py-2.5">Expires</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {sess.map(s => (
            <tr key={s.id} className="hover:bg-zinc-900/30">
              <td className="py-3 text-zinc-100">{s.name}</td>
              <td className="py-3 font-mono text-cyan-300">{s.ip ?? '—'}</td>
              <td className="py-3 text-zinc-400 truncate max-w-[300px]">{s.ua ?? '—'}</td>
              <td className="py-3 font-mono text-zinc-500">{s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}</td>
              <td className="py-3 font-mono text-zinc-500">{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
          {sess.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[12px] text-zinc-600">No active sessions.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}
