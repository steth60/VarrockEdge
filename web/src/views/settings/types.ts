export interface VNetwork {
  id: number;
  name: string;
  vlanId: number | null;
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
  enabled: boolean;
  isDefault: boolean;
  upnpAllowed: boolean;
  vlanIface: string;
  link: 'up' | 'down' | 'synthetic';
  leasesUsed: number;
  leasesTotal: number;
  leasesAvailable: number;
}

export interface WanLink {
  id: number;
  iface: string;
  label: string;
  role: string;
  priority: number;
  healthTarget: string;
  enabled: boolean;
  isp: string | null;
  wanPort: number | null;
  ipv4: string | null;
  ipv6: string | null;
  uptimePct: number | null;
  uptimeSince: number | null;
  health: { status: 'up' | 'degraded' | 'down'; rttMs: number | null; lossPct: number | null; ts: number | null };
}

export const PURPOSES = ['corporate', 'guest', 'iot', 'management'] as const;
