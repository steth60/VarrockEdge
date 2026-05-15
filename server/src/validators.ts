// Central input-validation allowlists for VarrokEdge.
//
// Every untrusted value that reaches a privileged config file (wg0.conf,
// dnsmasq.d/*.conf, miniupnpd.conf) or a root-level argv must pass through
// here. Validation is applied in *both* layers — zod helpers at the HTTP edge
// (good 400s) and the raw guards inside system/* render+exec functions — so
// non-HTTP entry points (db/seed, importPeerFromConfig, parseWgConfig) cannot
// inject either. A newline in a config-file value injects a `PostUp` /
// `dhcp-script` directive that runs as root; an argv value starting with `-`
// becomes an unintended flag.

import { z } from 'zod';

// --- raw regexes ------------------------------------------------------------

// IPv4 with bounded octets (0-255) — the old inline `\d{1,3}` regexes accepted
// 999.999.999.999.
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_SRC = `${OCTET}(\\.${OCTET}){3}`;
const PREFIX = '(3[0-2]|[12]?\\d)'; // 0-32

export const IPV4 = new RegExp(`^${IPV4_SRC}$`);
export const CIDR = new RegExp(`^${IPV4_SRC}/${PREFIX}$`);
export const CIDR_LIST = new RegExp(`^${IPV4_SRC}/${PREFIX}(\\s*,\\s*${IPV4_SRC}/${PREFIX})*$`);
export const IP_LIST = new RegExp(`^${IPV4_SRC}(\\s*,\\s*${IPV4_SRC})*$`);

// Network interface name: must start with a letter, <=14 base chars (Linux
// IFNAMSIZ is 16), with an optional `.VLAN` suffix. Crucially forbids a leading
// `-` so the value can never be parsed as a flag by `ip`/`iptables`.
export const IFACE = /^[a-zA-Z][a-zA-Z0-9]{0,13}(\.\d{1,4})?$/;

// WireGuard key: 32 raw bytes -> 44-char base64 ending in a single `=`.
export const WG_KEY = /^[A-Za-z0-9+/]{43}=$/;

// host:port endpoint (hostname or IPv4, then a port).
export const ENDPOINT = /^[a-zA-Z0-9.-]{1,253}:\d{1,5}$/;

// DNS hostname / FQDN (labels, underscores allowed for SRV-style records).
export const HOSTNAME =
  /^(?=.{1,253}$)([a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)(\.[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*$/;

// dnsmasq lease duration, e.g. `24h`, `30m`, `1d`, `infinite`.
export const DNSMASQ_LEASE = /^(\d+[smhd]|infinite)$/;

// MAC address.
export const MAC = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

// Free-text comment / label — printable subset, no newlines, no shell/config
// metacharacters.
export const COMMENT = /^[\w .,:/()-]{0,255}$/;

// Back-compat aliases for the inline regexes previously scattered across
// routes/* — kept so existing imports can switch over without renaming.
export const ipRe = IPV4;
export const cidrRe = CIDR;
export const ifaceRe = IFACE;
export const macRe = MAC;

// --- raw guards (used inside system/* render + exec paths) ------------------

/** Throw if the value contains a CR/LF — the config-file injection primitive. */
export function noNewline(v: string, label = 'value'): string {
  if (typeof v !== 'string') throw new Error(`${label}: expected a string`);
  if (/[\r\n]/.test(v)) throw new Error(`${label}: illegal newline in config value`);
  return v;
}

/**
 * Throw if the value is unsafe to pass as a positional argv element to a root
 * process: rejects newlines and any value beginning with `-` (argument
 * injection — e.g. an interface name `--modprobe=/tmp/x`).
 */
export function assertSafeArg(v: string, label = 'arg'): string {
  noNewline(v, label);
  if (v.startsWith('-')) throw new Error(`${label}: must not start with '-'`);
  return v;
}

/** Validate a value against a regex, throwing on mismatch. For system layer. */
export function assertMatches(v: string, re: RegExp, label: string): string {
  noNewline(v, label);
  if (!re.test(v)) throw new Error(`${label}: invalid value`);
  return v;
}

/** Sanitize a value destined for a dnsmasq drop-in line. Rejects newlines. */
export function dnsmasqValue(v: string, label = 'value'): string {
  return noNewline(v, label);
}

// --- zod helpers (used in routes/* schemas) ---------------------------------

export const zIp = z.string().regex(IPV4, 'expected an IPv4 address');
export const zCidr = z.string().regex(CIDR, 'expected CIDR like 10.0.0.0/24');
export const zCidrList = z.string().regex(CIDR_LIST, 'expected comma-separated CIDRs');
export const zIpList = z.string().regex(IP_LIST, 'expected comma-separated IPv4 addresses');
export const zIface = z.string().regex(IFACE, 'invalid network interface name');
export const zWgKey = z.string().regex(WG_KEY, 'expected a 44-character WireGuard base64 key');
export const zEndpoint = z.string().regex(ENDPOINT, 'expected host:port');
export const zHostname = z.string().min(1).max(253).regex(HOSTNAME, 'invalid hostname');
export const zLease = z.string().regex(DNSMASQ_LEASE, 'expected a lease like 24h or infinite');
export const zMac = z.string().regex(MAC, 'expected a MAC address');
export const zComment = z.string().regex(COMMENT, 'comment contains invalid characters');
export const zPort = z.number().int().min(1).max(65535);

// Password policy (finding M4): >= 12 chars, reject well-known weak values.
const WEAK_PASSWORDS = new Set([
  'admin', 'change-me', 'changeme', 'password', 'password1', '12345678',
  '123456789', 'varrokedge', 'varrok-edge', 'letmein', 'qwertyui',
]);
export const zPassword = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(200)
  .refine((p) => !WEAK_PASSWORDS.has(p.toLowerCase()), 'password is too common — choose another');
