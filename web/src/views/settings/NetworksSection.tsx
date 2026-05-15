import { useEffect, useState } from 'react';
import { Card, Button, Modal, Field, Input, Select, Badge, Icon, ToggleSwitch, SettingRow } from '../../components/primitives';
import { api } from '../../api/client';
import { PURPOSES, type VNetwork } from './types';

interface Draft {
  name: string;
  vlanId: string;        // blank = native/untagged
  iface: string;
  subnet: string;
  gateway: string;
  dhcpEnabled: boolean;
  dhcpStart: string;
  dhcpEnd: string;
  leaseTime: string;
  dnsServers: string;
  domain: string;
  purpose: string;
  upnpAllowed: boolean;
}

const blankDraft: Draft = {
  name: '', vlanId: '', iface: 'eth1', subnet: '', gateway: '',
  dhcpEnabled: true, dhcpStart: '', dhcpEnd: '', leaseTime: '24h',
  dnsServers: '1.1.1.1', domain: 'varrok.local', purpose: 'corporate',
  upnpAllowed: false,
};

const linkDot = (l: string) => l === 'up' ? 'bg-emerald-400' : l === 'synthetic' ? 'bg-zinc-500' : 'bg-rose-400';

export function NetworksSection() {
  const [nets, setNets] = useState<VNetwork[]>([]);
  const [editing, setEditing] = useState<VNetwork | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => api.get<{ networks: VNetwork[] }>('/api/networks').then(r => setNets(r.networks)).catch(() => {});
  useEffect(() => { reload(); }, []);

  const openCreate = () => { setDraft(blankDraft); setCreating(true); setEditing(null); setErr(null); };
  const openEdit = (n: VNetwork) => {
    setDraft({
      name: n.name, vlanId: n.vlanId == null ? '' : String(n.vlanId), iface: n.iface,
      subnet: n.subnet, gateway: n.gateway, dhcpEnabled: n.dhcpEnabled,
      dhcpStart: n.dhcpStart, dhcpEnd: n.dhcpEnd, leaseTime: n.leaseTime,
      dnsServers: n.dnsServers, domain: n.domain, purpose: n.purpose,
      upnpAllowed: n.upnpAllowed,
    });
    setEditing(n); setCreating(false); setErr(null);
  };
  const close = () => { setCreating(false); setEditing(null); setErr(null); };

  const save = async () => {
    setBusy(true); setErr(null);
    const body: any = {
      name: draft.name.trim(),
      vlanId: draft.vlanId.trim() ? Number(draft.vlanId) : null,
      iface: draft.iface.trim(),
      subnet: draft.subnet.trim(),
      gateway: draft.gateway.trim(),
      dhcpEnabled: draft.dhcpEnabled,
      dhcpStart: draft.dhcpStart.trim(),
      dhcpEnd: draft.dhcpEnd.trim(),
      leaseTime: draft.leaseTime.trim() || '24h',
      dnsServers: draft.dnsServers.trim(),
      domain: draft.domain.trim(),
      purpose: draft.purpose,
      upnpAllowed: draft.upnpAllowed,
    };
    try {
      if (editing) await api.patch(`/api/networks/${editing.id}`, body);
      else await api.post('/api/networks', body);
      close(); reload();
    } catch (e: any) {
      setErr(e?.message ?? 'save failed');
    } finally { setBusy(false); }
  };

  const remove = async (n: VNetwork) => {
    if (!window.confirm(`Delete network "${n.name}"? Its VLAN interface will be torn down.`)) return;
    try { await api.delete(`/api/networks/${n.id}`); reload(); }
    catch (e: any) { alert(e?.message ?? 'delete failed'); }
  };

  return (
    <div className="space-y-6">
      <Card title="Networks" subtitle={`${nets.length} virtual network${nets.length === 1 ? '' : 's'} · VLAN-aware`}
            action={<Button variant="primary" size="sm" icon="Plus" onClick={openCreate}>Create New</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                <th className="font-medium py-2.5 pr-4">Name</th>
                <th className="font-medium py-2.5 pr-4">VLAN ID</th>
                <th className="font-medium py-2.5 pr-4">Router</th>
                <th className="font-medium py-2.5 pr-4">Subnet</th>
                <th className="font-medium py-2.5 pr-4">IPv6 Subnet</th>
                <th className="font-medium py-2.5 pr-4">DHCP</th>
                <th className="font-medium py-2.5 pr-4">IP Leases</th>
                <th className="font-medium py-2.5 pr-4">Available</th>
                <th className="font-medium py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {nets.map(n => (
                <tr key={n.id} className="hover:bg-zinc-900/30 group">
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${linkDot(n.link)}`} title={n.link} />
                      <span className="text-zinc-100">{n.name}</span>
                      {n.isDefault && <Badge variant="neutral" size="sm">default</Badge>}
                      {n.upnpAllowed && <Badge variant="warn" size="sm">UPnP</Badge>}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{n.vlanId ?? '—'}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-300">{n.gateway}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-300">{n.subnet}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-600">—</td>
                  <td className="py-3 pr-4">{n.dhcpEnabled ? <span className="text-emerald-300">Server</span> : <span className="text-zinc-500">Off</span>}</td>
                  <td className="py-3 pr-4 font-mono text-cyan-300">{n.leasesUsed} / {n.leasesTotal}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{n.leasesAvailable}</td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" icon="Pencil" onClick={() => openEdit(n)}>Edit</Button>
                      {!n.isDefault && <Button variant="danger" size="sm" icon="Trash2" onClick={() => remove(n)}>Delete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {nets.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-[12px] text-zinc-600">no networks — click Create New</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <GlobalNetworkOptions />

      <Modal
        open={creating || editing != null}
        onClose={close}
        size="lg"
        title={editing ? `Edit ${editing.name}` : 'Create network'}
        subtitle={editing ? 'Changing the VLAN, subnet or gateway re-creates the interface' : 'Define a VLAN-tagged virtual network with its own DHCP scope'}
        footer={<>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" icon="Check" onClick={save}
                  disabled={busy || !draft.name.trim() || !draft.subnet.trim() || !draft.gateway.trim() || (draft.dhcpEnabled && (!draft.dhcpStart.trim() || !draft.dhcpEnd.trim()))}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create network'}
          </Button>
        </>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Network name">
            <Input placeholder="IoT VLAN" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="VLAN ID" hint="Blank = native / untagged">
            <Input mono type="number" placeholder="114" value={draft.vlanId}
                   onChange={(e) => setDraft({ ...draft, vlanId: e.target.value })}
                   disabled={editing?.isDefault} />
          </Field>
          <Field label="Base interface">
            <Input mono value={draft.iface} onChange={(e) => setDraft({ ...draft, iface: e.target.value })} disabled={editing?.isDefault} />
          </Field>
          <Field label="Purpose">
            <Select value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}>
              {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Subnet (CIDR)">
            <Input mono placeholder="10.10.114.0/24" value={draft.subnet} onChange={(e) => setDraft({ ...draft, subnet: e.target.value })} />
          </Field>
          <Field label="Gateway" hint="Appliance IP on this network">
            <Input mono placeholder="10.10.114.1" value={draft.gateway} onChange={(e) => setDraft({ ...draft, gateway: e.target.value })} />
          </Field>
          <div className="md:col-span-2 flex items-center gap-3 py-1">
            <ToggleSwitch value={draft.dhcpEnabled} onChange={(v) => setDraft({ ...draft, dhcpEnabled: v })} />
            <span className="text-[12.5px] text-zinc-200">Run a DHCP server on this network</span>
          </div>
          <div className="md:col-span-2 flex items-center gap-3 py-1">
            <ToggleSwitch value={draft.upnpAllowed} onChange={(v) => setDraft({ ...draft, upnpAllowed: v })} />
            <span className="text-[12.5px] text-zinc-200">Allow UPnP / NAT-PMP</span>
            <span className="text-[11px] text-zinc-500">devices here may auto-open WAN ports</span>
          </div>
          {draft.dhcpEnabled && <>
            <Field label="DHCP range start">
              <Input mono placeholder="10.10.114.50" value={draft.dhcpStart} onChange={(e) => setDraft({ ...draft, dhcpStart: e.target.value })} />
            </Field>
            <Field label="DHCP range end">
              <Input mono placeholder="10.10.114.200" value={draft.dhcpEnd} onChange={(e) => setDraft({ ...draft, dhcpEnd: e.target.value })} />
            </Field>
            <Field label="Lease time">
              <Input mono value={draft.leaseTime} onChange={(e) => setDraft({ ...draft, leaseTime: e.target.value })} />
            </Field>
            <Field label="DNS servers" hint="Comma-separated">
              <Input mono value={draft.dnsServers} onChange={(e) => setDraft({ ...draft, dnsServers: e.target.value })} />
            </Field>
            <Field label="Domain" className="md:col-span-2">
              <Input mono value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} />
            </Field>
          </>}
        </div>
        {err && (
          <div className="mt-4 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11.5px] text-rose-300 flex gap-1.5">
            <Icon name="AlertCircle" size={13} className="shrink-0 mt-0.5" />{err}
          </div>
        )}
      </Modal>
    </div>
  );
}

function GlobalNetworkOptions() {
  const [posture, setPosture] = useState('allow');
  const [mdns, setMdns] = useState('auto');
  const [igmp, setIgmp] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get<{ settings: Record<string, string> }>('/api/settings').then(r => {
      if (r.settings['net.securityPosture']) setPosture(r.settings['net.securityPosture']);
      if (r.settings['net.mdnsProxy']) setMdns(r.settings['net.mdnsProxy']);
      if (r.settings['net.igmpSnooping']) setIgmp(r.settings['net.igmpSnooping'] === 'on');
    }).catch(() => {});
  }, []);

  const save = async () => {
    try {
      await api.patch('/api/settings', {
        'net.securityPosture': posture,
        'net.mdnsProxy': mdns,
        'net.igmpSnooping': igmp ? 'on' : 'off',
      });
      setDirty(false);
    } catch (e: any) { alert(e?.message ?? 'save failed'); }
  };

  return (
    <Card title="Global network options" subtitle="Appliance-wide defaults applied to inter-network traffic">
      <SettingRow label="Default security posture" hint="How traffic between networks is treated unless a firewall rule says otherwise.">
        <div className="inline-flex rounded-lg bg-zinc-900/60 border border-zinc-800/60 p-1">
          {['allow', 'block'].map(p => (
            <button key={p} onClick={() => { setPosture(p); setDirty(true); }}
                    className={`px-3 h-7 text-[12px] rounded-md font-medium transition-colors ${posture === p ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
              {p === 'allow' ? 'Allow All' : 'Block All'}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Gateway mDNS proxy" hint="Relay Bonjour/mDNS discovery across VLANs.">
        <Select className="max-w-[160px]" value={mdns} onChange={(e) => { setMdns(e.target.value); setDirty(true); }}>
          <option value="auto">Auto</option>
          <option value="off">Off</option>
        </Select>
      </SettingRow>
      <SettingRow label="IGMP snooping" hint="Constrain multicast flooding on bridged networks.">
        <ToggleSwitch value={igmp} onChange={(v) => { setIgmp(v); setDirty(true); }} />
      </SettingRow>
      <div className="pt-4 flex justify-end">
        <Button variant="primary" icon="Save" onClick={save} disabled={!dirty}>Save options</Button>
      </div>
    </Card>
  );
}
