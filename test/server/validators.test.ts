import { describe, it, expect } from 'vitest';
import {
  IPV4, CIDR, IFACE, WG_KEY, HOSTNAME,
  noNewline, assertSafeArg, zPassword, zCidrList,
} from '../../server/src/validators';

describe('validators: regexes', () => {
  it('IPV4 accepts valid addresses and rejects out-of-range octets', () => {
    expect(IPV4.test('10.0.0.1')).toBe(true);
    expect(IPV4.test('255.255.255.255')).toBe(true);
    expect(IPV4.test('999.1.1.1')).toBe(false);
    expect(IPV4.test('10.0.0.1\n')).toBe(false);
    expect(IPV4.test('10.0.0')).toBe(false);
  });

  it('CIDR requires a valid prefix', () => {
    expect(CIDR.test('10.0.0.0/24')).toBe(true);
    expect(CIDR.test('10.0.0.0/33')).toBe(false);
    expect(CIDR.test('10.0.0.0')).toBe(false);
  });

  it('IFACE forbids a leading dash', () => {
    expect(IFACE.test('eth0')).toBe(true);
    expect(IFACE.test('eth0.100')).toBe(true);
    expect(IFACE.test('-batch')).toBe(false);
    expect(IFACE.test('--modprobe=/tmp/x')).toBe(false);
  });

  it('WG_KEY matches a 44-char base64 key', () => {
    expect(WG_KEY.test('A'.repeat(43) + '=')).toBe(true);
    expect(WG_KEY.test('too-short=')).toBe(false);
  });

  it('HOSTNAME rejects newlines and shell characters', () => {
    expect(HOSTNAME.test('svc.varrok.local')).toBe(true);
    expect(HOSTNAME.test('x\ndhcp-script=/tmp/e')).toBe(false);
    expect(HOSTNAME.test('a b')).toBe(false);
  });
});

describe('validators: guards', () => {
  it('noNewline throws on CR/LF', () => {
    expect(noNewline('10.0.0.0/24')).toBe('10.0.0.0/24');
    expect(() => noNewline('ok\nPostUp = evil')).toThrow(/newline/);
    expect(() => noNewline('ok\rx')).toThrow(/newline/);
  });

  it('assertSafeArg rejects a leading dash and newlines', () => {
    expect(assertSafeArg('eth0')).toBe('eth0');
    expect(() => assertSafeArg('-c')).toThrow(/must not start with/);
    expect(() => assertSafeArg('a\nb')).toThrow(/newline/);
  });
});

describe('validators: zod helpers', () => {
  it('zPassword enforces length and rejects common passwords', () => {
    expect(zPassword.safeParse('a-strong-passphrase').success).toBe(true);
    expect(zPassword.safeParse('short').success).toBe(false);
    expect(zPassword.safeParse('changeme1234').success).toBe(true); // not in denylist
    expect(zPassword.safeParse('change-me').success).toBe(false);
    expect(zPassword.safeParse('admin').success).toBe(false);
  });

  it('zCidrList accepts comma-separated CIDRs and rejects an injected newline', () => {
    expect(zCidrList.safeParse('10.10.0.2/32').success).toBe(true);
    expect(zCidrList.safeParse('10.10.0.2/32,10.20.0.0/24').success).toBe(true);
    expect(zCidrList.safeParse('10.10.0.2/32\nPostUp = sh').success).toBe(false);
  });
});
