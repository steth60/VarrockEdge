CREATE TABLE IF NOT EXISTS `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `email` text NOT NULL,
  `name` text NOT NULL,
  `password_hash` text NOT NULL,
  `role` text DEFAULT 'Admin' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `mfa_enabled` integer DEFAULT 0 NOT NULL,
  `last_seen_at` integer,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `ip` text,
  `ua` text,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `dhcp_reservations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `hostname` text NOT NULL,
  `mac` text NOT NULL,
  `ip` text NOT NULL,
  `lease` text DEFAULT '24h' NOT NULL,
  `comment` text,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `dhcp_reservations_mac_unique` ON `dhcp_reservations` (`mac`);

CREATE TABLE IF NOT EXISTS `dhcp_scope` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `range_start` text DEFAULT '10.0.0.50' NOT NULL,
  `range_end` text DEFAULT '10.0.0.200' NOT NULL,
  `lease_time` text DEFAULT '24h' NOT NULL,
  `gateway` text DEFAULT '10.0.0.1' NOT NULL,
  `dns_servers` text DEFAULT '10.0.0.1,1.1.1.1' NOT NULL,
  `domain` text DEFAULT 'varrok.local' NOT NULL
);

CREATE TABLE IF NOT EXISTS `dns_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `host` text NOT NULL,
  `type` text DEFAULT 'A' NOT NULL,
  `target` text NOT NULL,
  `ttl` integer DEFAULT 300 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `dns_records_host_unique` ON `dns_records` (`host`);

CREATE TABLE IF NOT EXISTS `dns_upstreams` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ip` text NOT NULL,
  `provider` text,
  `enabled` integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS `wg_server` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `private_key` text NOT NULL,
  `public_key` text NOT NULL,
  `listen_port` integer DEFAULT 51820 NOT NULL,
  `tunnel_cidr` text DEFAULT '10.10.0.0/24' NOT NULL,
  `mtu` integer DEFAULT 1420 NOT NULL,
  `public_endpoint` text,
  `dns_push` text DEFAULT '10.0.0.1,1.1.1.1' NOT NULL,
  `default_allowed_ips` text DEFAULT '10.0.0.0/24' NOT NULL
);

CREATE TABLE IF NOT EXISTS `wg_peers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `public_key` text NOT NULL,
  `private_key` text,
  `preshared_key` text,
  `allowed_ips` text NOT NULL,
  `keepalive` integer DEFAULT 25 NOT NULL,
  `kind` text DEFAULT 'road-warrior' NOT NULL,
  `remote_subnet` text,
  `remote_endpoint` text,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS `fw_dnat` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `src_port` integer NOT NULL,
  `proto` text DEFAULT 'tcp' NOT NULL,
  `dest_ip` text NOT NULL,
  `dest_port` integer NOT NULL,
  `comment` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS `fw_snat` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source` text NOT NULL,
  `out_iface` text DEFAULT 'eth0' NOT NULL,
  `mode` text DEFAULT 'MASQUERADE' NOT NULL,
  `to_source` text,
  `comment` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `is_core` integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS `fw_rules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `chain` text NOT NULL,
  `action` text NOT NULL,
  `proto` text DEFAULT 'all' NOT NULL,
  `source` text,
  `dport` text,
  `comment` text,
  `enabled` integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
