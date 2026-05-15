#!/usr/bin/env bash
# VarrokEdge installer — Debian / Ubuntu router appliance.
# Run with a terminal for the interactive setup wizard, or pass
# --non-interactive (env-var / default driven) for scripted installs.
set -euo pipefail
# Files created by this installer (notably the env file with the session
# secret and admin password) must never be world-readable.
umask 077

# ─── Preflight ───────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "✗ install.sh must be run as root (try: sudo bash install.sh)" >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "✗ apt-get not found. This installer targets Debian / Ubuntu." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

# ─── Arguments ───────────────────────────────────────────────────
NONINTERACTIVE=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes|--non-interactive) NONINTERACTIVE=1 ;;
    -h|--help)
      cat <<'USAGE'
VarrokEdge installer

  bash install.sh                    interactive TUI setup wizard
  bash install.sh --non-interactive  scripted install (env vars / defaults)

Non-interactive config (env vars, all optional):
  WAN_IFACE LAN_IFACE BIND_HOST PORT APP_DIR CONFIG_DIR DATA_DIR APP_USER

The TUI needs a real terminal — a piped `curl … | bash` runs non-interactively.
USAGE
      exit 0 ;;
  esac
done

# ─── Paths + defaults ────────────────────────────────────────────
APP_USER="${APP_USER:-root}"
APP_DIR="${APP_DIR:-/opt/varrok-edge}"
CONFIG_DIR="${CONFIG_DIR:-/etc/varrok-edge}"
DATA_DIR="${DATA_DIR:-/var/lib/varrok-edge}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
ENV_FILE="$CONFIG_DIR/env"
WAN_IFACE="${WAN_IFACE:-eth0}"
LAN_IFACE="${LAN_IFACE:-eth1}"
BIND_HOST="${BIND_HOST:-10.0.0.2}"
PORT="${PORT:-8080}"

# ─── Decide interactive vs scripted ──────────────────────────────
INTERACTIVE=0
if [[ $NONINTERACTIVE -eq 0 && -t 0 && -t 1 ]]; then
  if ! command -v whiptail >/dev/null 2>&1; then
    echo "▸ Installing whiptail (setup wizard)…"
    apt-get update -qq && apt-get install -y --no-install-recommends whiptail >/dev/null 2>&1 || true
  fi
  command -v whiptail >/dev/null 2>&1 && INTERACTIVE=1
fi

# ─── whiptail helpers ────────────────────────────────────────────
tui_msg()   { whiptail --title "VarrokEdge" --msgbox "$1" 16 76; }
tui_yesno() { whiptail --title "VarrokEdge" --yesno "$1" 14 76; }
tui_input() { whiptail --title "VarrokEdge" --inputbox "$1" 11 76 "${2:-}" 3>&1 1>&2 2>&3; }
tui_pass()  { whiptail --title "VarrokEdge" --passwordbox "$1" 11 76 3>&1 1>&2 2>&3; }
tui_menu()  { local p="$1"; shift; whiptail --title "VarrokEdge" --menu "$p" 20 76 9 "$@" 3>&1 1>&2 2>&3; }
cancelled() { echo "✗ Setup cancelled." >&2; exit 1; }

is_ip()       { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }
iface_ip()    { ip -4 -o addr show "$1" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1; }
rand_pw()     { head -c 18 /dev/urandom | base64 | tr -d '\n=' | tr '/+' 'AB'; }
rand_secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
old_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; } || true
}

# Emit whiptail --menu tag/item pairs (one per line) for every usable NIC.
iface_menu_args() {
  local exclude="${1:-}" n state ip4
  for n in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | cut -d@ -f1); do
    case "$n" in lo|wg*|veth*|fw*|tap*) continue ;; esac
    [[ -n "$exclude" && "$n" == "$exclude" ]] && continue
    state=$(ip -o link show "$n" 2>/dev/null | grep -oE 'state [A-Z]+' | awk '{print $2}' || true)
    ip4=$(iface_ip "$n")
    printf '%s\n%s\n' "$n" "${ip4:-no IPv4} · ${state:-?}"
  done
}

# ─── Install mode ────────────────────────────────────────────────
MODE="fresh"
if [[ -f "$ENV_FILE" ]]; then
  if [[ $INTERACTIVE -eq 1 ]]; then
    sel=$(tui_menu "An existing VarrokEdge install was found. What next?" \
      "upgrade"     "Upgrade in place — keep all current settings" \
      "reconfigure" "Reconfigure — change WAN / LAN / bind settings" \
      "cancel"      "Cancel the installer") || cancelled
    case "$sel" in
      upgrade)     MODE="upgrade" ;;
      reconfigure) MODE="reconfigure" ;;
      *)           cancelled ;;
    esac
  else
    MODE="upgrade"   # scripted re-run = upgrade in place
  fi
fi

# ─── Setup wizard (interactive fresh / reconfigure) ──────────────
if [[ "$MODE" == "reconfigure" ]]; then
  WAN_IFACE="$(old_env VE_WAN_IFACE)"; LAN_IFACE="$(old_env VE_LAN_IFACE)"
  BIND_HOST="$(old_env VE_BIND_HOST)"; PORT="$(old_env VE_PORT)"
fi

ADMIN_PW=""
if [[ "$MODE" != "upgrade" && $INTERACTIVE -eq 1 ]]; then
  tui_msg "Welcome to the VarrokEdge setup wizard.

This configures VarrokEdge as a network router / controller — you'll pick the
WAN and LAN interfaces and where the web UI listens.

Note: this installer does NOT assign IP addresses to your interfaces. Configure
the LAN interface's static IP at the OS level (netplan / ifupdown) yourself."

  mapfile -t WANARGS < <(iface_menu_args "")
  [[ ${#WANARGS[@]} -ge 2 ]] || { echo "✗ no usable network interfaces detected" >&2; exit 1; }
  WAN_IFACE=$(tui_menu "Select the WAN (internet-facing) interface:" "${WANARGS[@]}") || cancelled

  mapfile -t LANARGS < <(iface_menu_args "$WAN_IFACE")
  [[ ${#LANARGS[@]} -ge 2 ]] || { echo "✗ a second interface is required for the LAN side" >&2; exit 1; }
  LAN_IFACE=$(tui_menu "Select the LAN (private / clients) interface:" "${LANARGS[@]}") || cancelled

  defbind=$(iface_ip "$LAN_IFACE"); defbind="${defbind:-${BIND_HOST:-10.0.0.1}}"
  while :; do
    BIND_HOST=$(tui_input "Web UI bind address — the LAN IP of this machine, the address you browse to. It must be an IP this host actually holds." "$defbind") || cancelled
    is_ip "$BIND_HOST" && break
    tui_msg "'$BIND_HOST' is not a valid IPv4 address — try again."
  done
  if ! ip -4 -o addr show 2>/dev/null | grep -qw "$BIND_HOST"; then
    tui_yesno "Warning: $BIND_HOST is not currently assigned to any interface on this host. VarrokEdge will fail to start until it is.

Continue anyway?" || cancelled
  fi

  PORT=$(tui_input "Web UI port:" "${PORT:-8080}") || cancelled
  [[ "$PORT" =~ ^[0-9]+$ ]] || PORT=8080

  if [[ "$MODE" == "fresh" ]]; then
    if tui_yesno "Auto-generate a strong admin password?

Recommended — VarrokEdge forces you to set your own on first sign-in regardless." ; then
      ADMIN_PW="$(rand_pw)"
    else
      ADMIN_PW=$(tui_pass "Enter an initial admin password:") || cancelled
      [[ -n "$ADMIN_PW" ]] || ADMIN_PW="$(rand_pw)"
    fi
  fi

  tui_yesno "Review — proceed with the install?

  WAN interface : $WAN_IFACE
  LAN interface : $LAN_IFACE
  Web UI        : http://$BIND_HOST:$PORT
  App dir       : $APP_DIR
  Config dir    : $CONFIG_DIR
  Data dir      : $DATA_DIR" || cancelled
elif [[ "$MODE" == "fresh" ]]; then
  # Non-interactive fresh install — values come from env vars / defaults.
  ADMIN_PW="${VE_ADMIN_PASSWORD:-$(rand_pw)}"
fi

# ─── Write the env file ──────────────────────────────────────────
mkdir -p "$APP_DIR" "$CONFIG_DIR" "$DATA_DIR"
chmod 700 "$CONFIG_DIR"   # holds the secrets — root-only

FRESH_INSTALL=0
if [[ "$MODE" != "upgrade" ]]; then
  SESSION_SECRET="$(old_env VE_SESSION_SECRET)"
  [[ -n "$SESSION_SECRET" ]] || SESSION_SECRET="$(rand_secret)"
  if [[ "$MODE" == "reconfigure" ]]; then
    ADMIN_PW="$(old_env VE_ADMIN_PASSWORD)"   # password is unchanged on reconfigure
  else
    FRESH_INSTALL=1
  fi
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
fi

# The env file is now authoritative for every value the rest of the script uses.
set -a; source "$ENV_FILE"; set +a
WAN_IFACE="${VE_WAN_IFACE:-$WAN_IFACE}"; LAN_IFACE="${VE_LAN_IFACE:-$LAN_IFACE}"
BIND_HOST="${VE_BIND_HOST:-$BIND_HOST}"; PORT="${VE_PORT:-$PORT}"

echo "▸ VarrokEdge installer ($MODE)"
echo "  WAN / LAN : $WAN_IFACE / $LAN_IFACE"
echo "  bind      : http://$BIND_HOST:$PORT"

# ─── apt packages ────────────────────────────────────────────────
echo "▸ Installing system packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg openssl git \
  dnsmasq iptables iptables-persistent \
  wireguard-tools fail2ban conntrack iproute2 \
  miniupnpd \
  sqlite3 \
  build-essential python3 >/dev/null

# Ookla speedtest (optional, enabled by default). The repo-setup script is a
# third-party artifact — download it to a file (not piped blindly into a
# shell) so a truncated/failed fetch aborts under `set -e` and the script can
# be inspected. speedtest stays optional: the app degrades cleanly without it.
if ! command -v speedtest >/dev/null 2>&1; then
  echo "▸ Installing Ookla speedtest CLI"
  ook_tmp="$(mktemp)"
  if curl -fsSL https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh -o "$ook_tmp"; then
    bash "$ook_tmp" >/dev/null 2>&1 || true
    apt-get install -y speedtest >/dev/null 2>&1 || echo "  speedtest install skipped (offline or repo unavailable)"
  else
    echo "  speedtest repo script unavailable — skipping"
  fi
  rm -f "$ook_tmp"
fi

# ─── Lock down auto-started daemons ──────────────────────────────
# The miniupnpd package installs enabled with a stock config. VarrokEdge owns
# its lifecycle — UPnP is off by default and only ever binds opted-in LAN
# networks — so stop it now and let the control plane bring it up if asked.
echo "▸ Disabling miniupnpd (VarrokEdge manages it)"
systemctl disable --now miniupnpd >/dev/null 2>&1 || true

# ─── Node.js 20 ──────────────────────────────────────────────────
# Install via a pinned NodeSource apt repo + signed-by keyring rather than
# piping their setup script into a root shell. apt then verifies every
# package signature against that key.
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\|^v21\|^v22'; then
  echo "▸ Installing Node.js 20 (NodeSource, pinned keyring)"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
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
# `npm ci` installs exactly the committed package-lock — a reproducible build.
npm ci --no-fund >/dev/null

echo "▸ Building server + web bundle"
npm run build >/dev/null || {
  echo "  ✗ build failed — if this is a JavaScript heap OOM, give this machine" >&2
  echo "    at least 2 GB of RAM and re-run." >&2
  exit 1
}

# ─── DB migrate + seed ───────────────────────────────────────────
echo "▸ Running database migrations"
npm run db:migrate >/dev/null
npm run db:seed >/dev/null

# ─── systemd unit ────────────────────────────────────────────────
echo "▸ Installing systemd unit"
cat > /etc/systemd/system/varrok-edge.service <<EOF
[Unit]
Description=VarrokEdge — network router & controller
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
# Runs as root (intentional for a network appliance) but the blast radius of
# any code-execution bug is bounded: capabilities are capped to networking, no
# new privileges may be acquired, and kernel/cgroup/namespace surfaces locked.
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
NoNewPrivileges=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
RestrictRealtime=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
# ProtectSystem=strict + ReadWritePaths is a recommended further step but must
# be validated per deployment (the app writes /etc/dnsmasq.d, /etc/wireguard,
# /etc/iptables, /etc/miniupnpd, /etc/varrok-edge and /var/lib/{varrok-edge,
# miniupnpd}); left off here so an install never bricks on a path omission.

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

# append a rule to a chain only if an identical one is not already present
ipt4() { iptables  -C INPUT   "$@" 2>/dev/null || iptables  -A INPUT   "$@"; }
ipt6() { ip6tables -C INPUT   "$@" 2>/dev/null || ip6tables -A INPUT   "$@"; }
fwd4() { iptables  -C FORWARD "$@" 2>/dev/null || iptables  -A FORWARD "$@"; }
fwd6() { ip6tables -C FORWARD "$@" 2>/dev/null || ip6tables -A FORWARD "$@"; }

# IPv4 — LAN egress NAT (-t nat must precede the command verb)
iptables -t nat -C POSTROUTING -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -j MASQUERADE
# IPv4 — INPUT: trust loopback + LAN + established; permit only WireGuard
# inbound on the WAN. Everything else is dropped by the chain *policy* set
# below — the firewall fails closed if the WAN interface is ever renamed or a
# new interface appears, rather than relying solely on the explicit WAN DROP.
ipt4 -i lo -j ACCEPT
ipt4 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ipt4 -i "${LAN_IFACE}+" -j ACCEPT
ipt4 -i "$WAN_IFACE" -p udp --dport 51820 -j ACCEPT
ipt4 -i "$WAN_IFACE" -j DROP
# IPv4 — FORWARD: the appliance is a router. Permit LAN egress and established
# return traffic; the wg0 and per-DNAT accepts are added at runtime by the app.
fwd4 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
fwd4 -i "${LAN_IFACE}+" -j ACCEPT
# Fail closed — set the default policy AFTER the accepts so the install never
# locks itself out (the installer's own session is ESTABLISHED).
iptables -P FORWARD DROP
iptables -P INPUT DROP
iptables-save > /etc/iptables/rules.v4 || true

# IPv6 — same lockdown when the stack is present. ICMPv6 must stay open
# (NDP / PMTUD) or IPv6 breaks entirely.
if command -v ip6tables >/dev/null 2>&1 && ip6tables -L >/dev/null 2>&1; then
  ipt6 -i lo -j ACCEPT
  ipt6 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ipt6 -p ipv6-icmp -j ACCEPT
  ipt6 -i "${LAN_IFACE}+" -j ACCEPT
  ipt6 -i "$WAN_IFACE" -p udp --dport 51820 -j ACCEPT
  ipt6 -i "$WAN_IFACE" -j DROP
  fwd6 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  fwd6 -p ipv6-icmp -j ACCEPT
  fwd6 -i "${LAN_IFACE}+" -j ACCEPT
  ip6tables -P FORWARD DROP
  ip6tables -P INPUT DROP
  ip6tables-save > /etc/iptables/rules.v6 || true
fi

# ─── Bring up service ────────────────────────────────────────────
echo "▸ Starting varrok-edge.service"
systemctl restart varrok-edge.service
sleep 2
if ! systemctl is-active --quiet varrok-edge.service; then
  echo "  ✗ service failed to start — check: journalctl -u varrok-edge -e" >&2
  exit 1
fi

# ─── Done ────────────────────────────────────────────────────────
if [[ "$FRESH_INSTALL" == "1" ]]; then
  pw_line="Password  : set on first sign-in. Initial value:
            sudo grep '^VE_ADMIN_PASSWORD=' $ENV_FILE"
else
  pw_line="Password  : unchanged (see $ENV_FILE)"
fi
SUMMARY="VarrokEdge is installed and running.

  URL       : http://$BIND_HOST:$PORT
  Username  : admin@varrok.local
  $pw_line

  Logs      : journalctl -u varrok-edge -f
  Service   : systemctl status varrok-edge"

if [[ $INTERACTIVE -eq 1 ]]; then
  tui_msg "$SUMMARY"
else
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "$SUMMARY"
  echo "════════════════════════════════════════════════════════════"
fi
