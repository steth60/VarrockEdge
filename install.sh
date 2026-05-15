#!/usr/bin/env bash
# VarrokEdge installer — Debian 12 / Ubuntu 24.04 LXC container
set -euo pipefail

# ─── Preflight ───────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "✗ install.sh must be run as root (try: sudo bash install.sh)" >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "✗ apt-get not found. This installer targets Debian/Ubuntu LXC containers." >&2
  exit 1
fi

# ─── Config ──────────────────────────────────────────────────────
APP_USER="${APP_USER:-root}"
APP_DIR="${APP_DIR:-/opt/varrok-edge}"
CONFIG_DIR="${CONFIG_DIR:-/etc/varrok-edge}"
DATA_DIR="${DATA_DIR:-/var/lib/varrok-edge}"
WAN_IFACE="${WAN_IFACE:-eth0}"
LAN_IFACE="${LAN_IFACE:-eth1}"
BIND_HOST="${BIND_HOST:-10.0.0.2}"
PORT="${PORT:-8080}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

echo "▸ VarrokEdge installer"
echo "  source        : $SRC_DIR"
echo "  app dir       : $APP_DIR"
echo "  config dir    : $CONFIG_DIR"
echo "  data dir      : $DATA_DIR"
echo "  WAN / LAN     : $WAN_IFACE / $LAN_IFACE"
echo "  bind          : http://$BIND_HOST:$PORT"
echo ""

# ─── apt packages ────────────────────────────────────────────────
echo "▸ Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg openssl git \
  dnsmasq iptables iptables-persistent \
  wireguard-tools fail2ban conntrack iproute2 \
  miniupnpd \
  sqlite3 \
  build-essential python3 >/dev/null

# Ookla speedtest (optional but enabled by default). Their apt repo:
if ! command -v speedtest >/dev/null 2>&1; then
  echo "▸ Installing Ookla speedtest CLI"
  curl -fsSL https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash >/dev/null 2>&1 || true
  apt-get install -y speedtest >/dev/null 2>&1 || echo "  speedtest install skipped (offline or repo unavailable)"
fi

# ─── Lock down auto-started daemons ──────────────────────────────
# The miniupnpd package installs enabled with a stock config. VarrokEdge owns
# its lifecycle — UPnP is off by default and only ever binds opted-in LAN
# networks — so stop it now and let the control plane bring it up if asked.
echo "▸ Disabling miniupnpd (VarrokEdge manages it)"
systemctl disable --now miniupnpd >/dev/null 2>&1 || true

# ─── Node.js 20 ──────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\|^v21\|^v22'; then
  echo "▸ Installing Node.js 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
echo "  node $(node -v) · npm $(npm -v)"

# ─── Disable systemd-resolved so port 53 is free ────────────────
if systemctl is-enabled systemd-resolved >/dev/null 2>&1; then
  echo "▸ Disabling systemd-resolved to free port 53"
  systemctl disable --now systemd-resolved >/dev/null 2>&1 || true
  if [[ -L /etc/resolv.conf ]]; then rm -f /etc/resolv.conf; fi
  if [[ ! -s /etc/resolv.conf ]]; then
    cat > /etc/resolv.conf <<EOF
nameserver 1.1.1.1
nameserver 8.8.8.8
options edns0 trust-ad
EOF
  fi
fi

# ─── Copy app source ─────────────────────────────────────────────
echo "▸ Installing application to $APP_DIR"
mkdir -p "$APP_DIR" "$CONFIG_DIR" "$DATA_DIR"
# Use rsync if available, else cp -r
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude dist --exclude var --exclude '*.db' --exclude '*.tsbuildinfo' \
    "$SRC_DIR/" "$APP_DIR/"
else
  cp -r "$SRC_DIR/." "$APP_DIR/"
fi

cd "$APP_DIR"

# ─── Install npm deps + build ────────────────────────────────────
echo "▸ Installing npm dependencies (this can take a few minutes)"
npm install --no-audit --no-fund >/dev/null

echo "▸ Building server + web bundle"
npm run build >/dev/null

# ─── Generate secrets if missing ─────────────────────────────────
ENV_FILE="$CONFIG_DIR/env"
if [[ ! -f "$ENV_FILE" ]]; then
  ADMIN_PW="$(openssl rand -base64 18 | tr -d '\n' | tr '/+' 'AB')"
  SESSION_SECRET="$(openssl rand -base64 32)"
  cat > "$ENV_FILE" <<EOF
VE_BIND_HOST=$BIND_HOST
VE_PORT=$PORT
VE_DB_PATH=$DATA_DIR/varrok-edge.db
VE_CONFIG_DIR=$CONFIG_DIR
VE_WAN_IFACE=$WAN_IFACE
VE_LAN_IFACE=$LAN_IFACE
VE_ADMIN_PASSWORD=$ADMIN_PW
VE_SESSION_SECRET=$SESSION_SECRET
VE_LOG_LEVEL=info
EOF
  chmod 600 "$ENV_FILE"
  FRESH_INSTALL=1
else
  FRESH_INSTALL=0
fi

# ─── DB migrate + seed ───────────────────────────────────────────
echo "▸ Running database migrations"
set -a; source "$ENV_FILE"; set +a
npm run db:migrate >/dev/null
npm run db:seed >/dev/null

# ─── systemd unit ────────────────────────────────────────────────
echo "▸ Installing systemd unit"
cat > /etc/systemd/system/varrok-edge.service <<EOF
[Unit]
Description=VarrokEdge — Lightweight Proxmox Network Controller
After=network-online.target dnsmasq.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/server/dist/index.js
Restart=on-failure
RestartSec=3s
StandardOutput=journal
StandardError=journal
# Privileged — needs CAP_NET_ADMIN for iptables and write access to /etc.
# Running as root is intentional for an appliance LXC.
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable varrok-edge.service >/dev/null

# ─── Firewall bootstrap — WAN lockdown + LAN NAT ─────────────────
# The appliance has a routable WAN IP. Nothing it runs (web UI, dnsmasq,
# SSH, miniupnpd …) may be reachable from the WAN side — every inbound
# connection on $WAN_IFACE is dropped except the WireGuard listener.
echo "▸ Bootstrapping firewall — locking down $WAN_IFACE"
mkdir -p /etc/iptables

# append an INPUT rule only if an identical one is not already present
ipt4() { iptables  -C INPUT "$@" 2>/dev/null || iptables  -A INPUT "$@"; }
ipt6() { ip6tables -C INPUT "$@" 2>/dev/null || ip6tables -A INPUT "$@"; }

# IPv4 — LAN egress NAT (-t nat must precede the command verb)
iptables -t nat -C POSTROUTING -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -j MASQUERADE
# IPv4 — INPUT: trust loopback + LAN + established; permit only WireGuard
# inbound on the WAN; drop everything else arriving on the WAN.
ipt4 -i lo -j ACCEPT
ipt4 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ipt4 -i "$LAN_IFACE" -j ACCEPT
ipt4 -i "$WAN_IFACE" -p udp --dport 51820 -j ACCEPT
ipt4 -i "$WAN_IFACE" -j DROP
iptables-save > /etc/iptables/rules.v4 || true

# IPv6 — same lockdown when the stack is present. ICMPv6 must stay open
# (NDP / PMTUD) or IPv6 breaks entirely.
if command -v ip6tables >/dev/null 2>&1 && ip6tables -L >/dev/null 2>&1; then
  ipt6 -i lo -j ACCEPT
  ipt6 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ipt6 -p ipv6-icmp -j ACCEPT
  ipt6 -i "$LAN_IFACE" -j ACCEPT
  ipt6 -i "$WAN_IFACE" -p udp --dport 51820 -j ACCEPT
  ipt6 -i "$WAN_IFACE" -j DROP
  ip6tables-save > /etc/iptables/rules.v6 || true
fi

# ─── Bring up service ────────────────────────────────────────────
echo "▸ Starting varrok-edge.service"
systemctl restart varrok-edge.service

sleep 2
if systemctl is-active --quiet varrok-edge.service; then
  echo "  ✓ service is active"
else
  echo "  ✗ service failed to start — check: journalctl -u varrok-edge -e"
  exit 1
fi

# ─── Output ──────────────────────────────────────────────────────
ADMIN_PW="$(grep '^VE_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  VarrokEdge installed"
echo "════════════════════════════════════════════════════════════"
echo "  URL       : http://$BIND_HOST:$PORT"
echo "  Username  : admin@varrok.local"
if [[ "$FRESH_INSTALL" == "1" ]]; then
  echo "  Password  : $ADMIN_PW"
  echo ""
  echo "  (Password is stored in $ENV_FILE — change it after first sign-in.)"
else
  echo "  Password  : (unchanged — see $ENV_FILE)"
fi
echo ""
echo "  Logs      : journalctl -u varrok-edge -f"
echo "  Service   : systemctl status varrok-edge"
echo "════════════════════════════════════════════════════════════"
