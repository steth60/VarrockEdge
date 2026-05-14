# fail2ban

[fail2ban](https://github.com/fail2ban/fail2ban) watches log files for
patterns and (most commonly) adds banning iptables rules when a source IP
triggers a jail. VarrokEdge uses it as the **enforcement layer** for its
detection engine.

## What VarrokEdge does with it

- The detector (`server/src/system/detector.ts`) tails the journal and
  raises threats on configurable severity.
- When an operator escalates a threat or hits "Add ban" on the Block
  list, VarrokEdge calls `fail2ban-client set <jail> banip <ip>`.
- The Block list page reads `fail2ban-client status` to enumerate jails,
  then `fail2ban-client status <jail>` to pull the **Banned IP list**
  for each.
- Unban: `fail2ban-client unban <ip>` (across all jails).

## Mapping: VarrokEdge action → fail2ban command

| Action       | Command                                       |
|--------------|-----------------------------------------------|
| List bans    | `fail2ban-client status <jail>` (per jail)    |
| Ban an IP    | `fail2ban-client set <jail> banip <ip>`       |
| Unban an IP  | `fail2ban-client unban <ip>`                  |
| Status       | `fail2ban-client status` (lists all jails)    |

## Install / configure

```bash
sudo apt-get install fail2ban

# Default config is in /etc/fail2ban/. Distro defaults already enable
# sshd jail. For a VarrokEdge appliance, enable recidive + nginx if you
# expose those:
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
# Edit jail.local to enable the jails you want, then:
sudo systemctl restart fail2ban
sudo fail2ban-client status
```

## Files touched

VarrokEdge does **not** write fail2ban config — it only calls the client.
If you want custom jails, drop them into `/etc/fail2ban/jail.d/*.local`
manually.

| Path                              | Owner       | Purpose                          |
|-----------------------------------|-------------|----------------------------------|
| `/etc/fail2ban/jail.local`        | operator    | jail definitions                 |
| `/etc/fail2ban/filter.d/*.conf`   | operator    | log-line regexes                 |
| `/var/log/fail2ban.log`           | fail2ban    | journal also reflects this       |

## Detector → fail2ban handoff

The default `ssh-bf` detection rule has `action: 'ban 7d'`. The detector
itself only **records** the threat — it does not auto-ban. The operator
explicitly escalates via the UI ("Permanently ban" / per-ban entry).
That's a design call: visibility first, automation second.

If you want auto-ban: hook
`POST /api/security/threats/:id/ban` into the detector's `recordEvent`
when `threat.count` crosses the rule's threshold. About 10 lines.

## Code references

- `server/src/system/fail2ban.ts` — wrapper (with macOS mock)
- `server/src/system/detector.ts` — threat aggregation
- `server/src/routes/security.ts` — `/api/security/bans` endpoints
