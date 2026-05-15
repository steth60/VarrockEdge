import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('Admin'), // Owner, Admin, Network, Read-only
  status: text('status').notNull().default('active'), // active, invited, suspended
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ip: text('ip'),
  ua: text('ua'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dhcpReservations = sqliteTable('dhcp_reservations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostname: text('hostname').notNull(),
  mac: text('mac').notNull().unique(),
  ip: text('ip').notNull(),
  lease: text('lease').notNull().default('24h'),
  comment: text('comment'),
  networkId: integer('network_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ─── VLAN-aware networks ("vnets") ──────────────────────────────────
export const networks = sqliteTable('networks', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  name:        text('name').notNull(),
  vlanId:      integer('vlan_id'),                       // NULL = native/untagged
  iface:       text('iface').notNull().default('eth1'),  // base interface
  subnet:      text('subnet').notNull(),                 // CIDR e.g. 10.10.114.0/24
  gateway:     text('gateway').notNull(),                // appliance IP on this net
  dhcpEnabled: integer('dhcp_enabled', { mode: 'boolean' }).notNull().default(true),
  dhcpStart:   text('dhcp_start').notNull(),
  dhcpEnd:     text('dhcp_end').notNull(),
  leaseTime:   text('lease_time').notNull().default('24h'),
  dnsServers:  text('dns_servers').notNull().default('1.1.1.1'),
  domain:      text('domain').notNull().default('varrok.local'),
  purpose:     text('purpose').notNull().default('corporate'), // corporate|guest|iot|management
  enabled:     integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isDefault:   integer('is_default', { mode: 'boolean' }).notNull().default(false),
  upnpAllowed: integer('upnp_allowed', { mode: 'boolean' }).notNull().default(false),
  createdAt:   integer('created_at').notNull(),
});

export const dhcpScope = sqliteTable('dhcp_scope', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  rangeStart: text('range_start').notNull().default('10.0.0.50'),
  rangeEnd: text('range_end').notNull().default('10.0.0.200'),
  leaseTime: text('lease_time').notNull().default('24h'),
  gateway: text('gateway').notNull().default('10.0.0.1'),
  dnsServers: text('dns_servers').notNull().default('10.0.0.1,1.1.1.1'),
  domain: text('domain').notNull().default('varrok.local'),
});

export const dnsRecords = sqliteTable('dns_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  host: text('host').notNull().unique(),
  type: text('type').notNull().default('A'), // A, AAAA, CNAME, TXT
  target: text('target').notNull(),
  ttl: integer('ttl').notNull().default(300),
});

export const dnsUpstreams = sqliteTable('dns_upstreams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ip: text('ip').notNull(),
  provider: text('provider'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const wgServer = sqliteTable('wg_server', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  privateKey: text('private_key').notNull(),
  publicKey: text('public_key').notNull(),
  listenPort: integer('listen_port').notNull().default(51820),
  tunnelCidr: text('tunnel_cidr').notNull().default('10.10.0.0/24'),
  mtu: integer('mtu').notNull().default(1420),
  publicEndpoint: text('public_endpoint'),
  dnsPush: text('dns_push').notNull().default('10.0.0.1,1.1.1.1'),
  defaultAllowedIps: text('default_allowed_ips').notNull().default('10.0.0.0/24'),
});

export const wgPeers = sqliteTable('wg_peers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key'), // only retained if we generated it (so user can re-download)
  presharedKey: text('preshared_key'),
  allowedIps: text('allowed_ips').notNull(),
  keepalive: integer('keepalive').notNull().default(25),
  kind: text('kind').notNull().default('road-warrior'), // road-warrior | site
  remoteSubnet: text('remote_subnet'),
  remoteEndpoint: text('remote_endpoint'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fwDnat = sqliteTable('fw_dnat', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  srcPort: integer('src_port').notNull(),
  proto: text('proto').notNull().default('tcp'), // tcp|udp|both
  destIp: text('dest_ip').notNull(),
  destPort: integer('dest_port').notNull(),
  comment: text('comment'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fwSnat = sqliteTable('fw_snat', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  outIface: text('out_iface').notNull().default('eth0'),
  mode: text('mode').notNull().default('MASQUERADE'), // MASQUERADE|SNAT
  toSource: text('to_source'),
  comment: text('comment'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false), // protected MASQUERADE rule
});

export const fwRules = sqliteTable('fw_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chain: text('chain').notNull(), // INPUT|FORWARD|OUTPUT
  action: text('action').notNull(), // ACCEPT|DROP|REJECT
  proto: text('proto').notNull().default('all'),
  source: text('source'),
  dport: text('dport'),
  comment: text('comment'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const detectionRules = sqliteTable('detection_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  severity: text('severity').notNull(),
  threshold: text('threshold').notNull(),
  action: text('action').notNull(),
  hits: integer('hits').notNull().default(0),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(true),
});

export const threats = sqliteTable('threats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ruleId: text('rule_id').notNull(),
  severity: text('severity').notNull(),
  kind: text('kind').notNull(),
  src: text('src').notNull(),
  dst: text('dst').notNull(),
  count: integer('count').notNull().default(1),
  firstSeenAt: integer('first_seen_at').notNull(),  // epoch ms
  lastSeenAt: integer('last_seen_at').notNull(),    // epoch ms
  status: text('status').notNull().default('monitoring'), // monitoring|flagged|rate-limit|banned|acked
  country: text('country'),
  desc: text('desc'),
});

export const eventBuckets = sqliteTable('event_buckets', {
  hour: integer('hour').primaryKey(), // Math.floor(Date.now() / 3_600_000)
  critical: integer('critical').notNull().default(0),
  high: integer('high').notNull().default(0),
  medium: integer('medium').notNull().default(0),
  low: integer('low').notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type DhcpReservation = typeof dhcpReservations.$inferSelect;
export type DnsRecord = typeof dnsRecords.$inferSelect;
export type WgPeer = typeof wgPeers.$inferSelect;
export type FwDnat = typeof fwDnat.$inferSelect;
export type FwSnat = typeof fwSnat.$inferSelect;
export type FwRule = typeof fwRules.$inferSelect;
export type DetectionRule = typeof detectionRules.$inferSelect;
export type Threat = typeof threats.$inferSelect;
export type EventBucket = typeof eventBuckets.$inferSelect;
export type Network = typeof networks.$inferSelect;

// ─── Per-flow telemetry (sampled from conntrack) ────────────────
export const flowTopClients = sqliteTable('flow_top_clients', {
  window:    text('window').notNull(),
  srcIp:     text('src_ip').notNull(),
  hostHint:  text('host_hint'),
  packets:   integer('packets').notNull().default(0),
  bytes:     integer('bytes').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const flowTopServices = sqliteTable('flow_top_services', {
  window:    text('window').notNull(),
  dport:     integer('dport').notNull(),
  proto:     text('proto').notNull(),
  packets:   integer('packets').notNull().default(0),
  bytes:     integer('bytes').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const flowTopDestinations = sqliteTable('flow_top_destinations', {
  window:      text('window').notNull(),
  dstIp:       text('dst_ip').notNull(),
  countryHint: text('country_hint'),
  packets:     integer('packets').notNull().default(0),
  bytes:       integer('bytes').notNull().default(0),
  updatedAt:   integer('updated_at').notNull(),
});

export const flowApps = sqliteTable('flow_apps', {
  window:    text('window').notNull(),
  app:       text('app').notNull(),
  downBytes: integer('down_bytes').notNull().default(0),
  upBytes:   integer('up_bytes').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const latencyBuckets = sqliteTable('latency_buckets', {
  minute:   integer('minute').primaryKey(),
  avgMs:    real('avg_ms'),
  lossPct:  real('loss_pct'),
});

export const availabilityBuckets = sqliteTable('availability_buckets', {
  target: text('target').notNull(),
  bucket: integer('bucket').notNull(),
  status: text('status').notNull(),
});

export const wanInterfaces = sqliteTable('wan_interfaces', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  iface:        text('iface').notNull().unique(),
  label:        text('label').notNull(),
  role:         text('role').notNull().default('primary'),
  priority:     integer('priority').notNull().default(100),
  healthTarget: text('health_target').notNull().default('1.1.1.1'),
  enabled:      integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isp:          text('isp'),
  wanPort:      integer('wan_port'),
  createdAt:    integer('created_at').notNull(),
});

export const wanHealth = sqliteTable('wan_health', {
  iface:   text('iface').notNull(),
  ts:      integer('ts').notNull(),
  status:  text('status').notNull(),
  rttMs:   real('rtt_ms'),
  lossPct: real('loss_pct'),
});

export const speedtestRuns = sqliteTable('speedtest_runs', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  ts:           integer('ts').notNull(),
  downloadMbps: real('download_mbps').notNull(),
  uploadMbps:   real('upload_mbps').notNull(),
  pingMs:       real('ping_ms').notNull(),
  isp:          text('isp'),
  server:       text('server'),
  source:       text('source').notNull(),
  trigger:      text('trigger').notNull().default('manual'),
});
