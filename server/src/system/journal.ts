import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config } from '../config';

export interface JournalLine {
  time: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'OK' | 'DEBUG';
  svc: string;
  msg: string;
}

const MOCK_LOG: JournalLine[] = [
  { time: '14:22:18', level: 'INFO',  svc: 'dnsmasq',  msg: 'DHCPACK(eth1) 10.0.0.118 bc:24:11:0e:91:4a gh-runner-02' },
  { time: '14:22:11', level: 'OK',    svc: 'wg-quick', msg: 'peer site-londonB: handshake established (6s)' },
  { time: '14:21:58', level: 'INFO',  svc: 'iptables', msg: 'DNAT eth0:25565 → 10.0.0.55:25565 hit (count 2381)' },
  { time: '14:21:42', level: 'WARN',  svc: 'nftables', msg: 'rule sync skew 184ms — consider lowering poll interval' },
  { time: '14:21:21', level: 'INFO',  svc: 'dnsmasq',  msg: 'reading /etc/dnsmasq.d/static.conf (4 hosts)' },
  { time: '14:20:55', level: 'DEBUG', svc: 'kernel',   msg: 'br0: port 3(veth104i0) entered forwarding state' },
  { time: '14:20:41', level: 'OK',    svc: 'wg-quick', msg: 'peer callum-laptop: handshake established (12s)' },
  { time: '14:20:14', level: 'ERROR', svc: 'fail2ban', msg: 'banned 185.220.101.42 (port 22, 6 attempts)' },
  { time: '14:19:53', level: 'INFO',  svc: 'dnsmasq',  msg: 'query[A] runner.varrok.local from 10.0.0.74' },
  { time: '14:19:32', level: 'INFO',  svc: 'systemd',  msg: 'Started Network Time Synchronization' },
];

export function recentLogs(limit = 100): JournalLine[] {
  if (!config.onLinux) return MOCK_LOG.slice(0, limit);
  return MOCK_LOG.slice(0, limit); // simplification — full journalctl integration in tail()
}

function parseLine(raw: string): JournalLine | null {
  // expecting "May 14 14:22:18 host svc[pid]: msg"
  const m = /^[A-Za-z]+\s+\d+\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+([^:\[]+)(?:\[\d+\])?:\s+(.*)$/.exec(raw);
  if (!m) return null;
  const [, time, svc, msg] = m;
  const lvl: JournalLine['level'] =
    /error|fail|denied|banned/i.test(msg) ? 'ERROR' :
    /warn|skew/i.test(msg) ? 'WARN' :
    /handshake|established/i.test(msg) ? 'OK' :
    /debug|forwarding state/i.test(msg) ? 'DEBUG' :
    'INFO';
  return { time: time ?? '', svc: (svc ?? '').trim(), msg: msg ?? '', level: lvl };
}

export function tail(units: string[]): EventEmitter & { stop: () => void } {
  const emitter = new EventEmitter() as EventEmitter & { stop: () => void };
  let proc: ChildProcess | undefined;
  let stopped = false;
  if (config.onLinux) {
    const args = ['-f', '-o', 'short', '--no-pager'];
    for (const u of units) args.push('-u', u);
    proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    proc.stdout?.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const ln of lines) {
        const parsed = parseLine(ln);
        if (parsed) emitter.emit('line', parsed);
      }
    });
    proc.on('close', () => emitter.emit('end'));
  } else {
    // Mock: emit one line every ~1.5s
    let i = 0;
    const t = setInterval(() => {
      if (stopped) return;
      const base = MOCK_LOG[i % MOCK_LOG.length]!;
      const d = new Date();
      const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
      emitter.emit('line', { ...base, time });
      i++;
    }, 1500);
    emitter.on('end', () => clearInterval(t));
  }
  emitter.stop = () => {
    stopped = true;
    proc?.kill('SIGTERM');
    emitter.emit('end');
  };
  return emitter;
}
