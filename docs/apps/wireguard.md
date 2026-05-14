# WireGuard

[WireGuard](https://www.wireguard.com/) is a modern in-kernel VPN.
VarrokEdge manages a single tunnel interface `wg0` and a list of peers.

## What VarrokEdge does with it

- Generates a server keypair the first time the app boots (via
  `wg genkey` / `wg pubkey`) and stores it in `wg_server`.
- Renders `/etc/wireguard/wg0.conf` from `wg_server` + `wg_peers` on
  every CRUD mutation.
- Reloads the live tunnel with `wg syncconf wg0 /dev/stdin` (no peer drop).
- Generates per-peer `.conf` files on demand and PNG QR codes (via the
  `qrcode` npm) for mobile clients.
- Reads peer status with `wg show wg0 dump` to display handshake age,
  endpoint, rx/tx bytes.

## Critical config

```
[Interface]
PrivateKey = ...
Address    = 10.10.0.1/24
ListenPort = 51820
MTU        = 1420
PostUp     = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown   = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
```

The `PostUp` / `PostDown` rules let WG peers reach the LAN (10.0.0.0/24)
and the public internet via NAT.

## Install / inspect

```bash
sudo apt-get install wireguard-tools

# Bring tunnel up / down
wg-quick up wg0
wg-quick down wg0

# Live state
wg show wg0
wg show wg0 dump   # machine-parseable format VarrokEdge uses

# Generate keys
wg genkey | tee privkey | wg pubkey > pubkey
wg genpsk
```

## Files touched

| Path                       | Owner       | Notes                              |
|----------------------------|-------------|------------------------------------|
| `/etc/wireguard/wg0.conf`  | VarrokEdge  | rewritten on every peer CRUD       |

The DB-stored peer `private_key` field is only populated when VarrokEdge
generated the keypair (so the `.conf` download still works). If a peer
was added with `providedPublicKey`, we never see its private key.

## Road-warrior vs site-to-site

Same `[Peer]` block, different `AllowedIPs`:

- **Road-warrior** — `AllowedIPs = 10.10.0.x/32`, one address per device.
  The issued `.conf` uses the server's `defaultAllowedIps`
  (`10.0.0.0/24` for split tunnel, `0.0.0.0/0` for full tunnel).
- **Site-to-site** — `AllowedIPs = 10.20.0.0/24` (the remote subnet).
  Routes are installed by `wg-quick` based on that.

## Code references

- `server/src/system/wireguard.ts` — keygen, config rendering, peer mgmt
- `server/src/routes/wireguard.ts` — REST endpoints
- `web/src/views/Wireguard.tsx` — UI with QR + .conf download
