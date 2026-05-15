CREATE TABLE IF NOT EXISTS `networks` (
  `id`           integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name`         text NOT NULL,
  `vlan_id`      integer,
  `iface`        text NOT NULL DEFAULT 'eth1',
  `subnet`       text NOT NULL,
  `gateway`      text NOT NULL,
  `dhcp_enabled` integer NOT NULL DEFAULT 1,
  `dhcp_start`   text NOT NULL,
  `dhcp_end`     text NOT NULL,
  `lease_time`   text NOT NULL DEFAULT '24h',
  `dns_servers`  text NOT NULL DEFAULT '1.1.1.1',
  `domain`       text NOT NULL DEFAULT 'varrok.local',
  `purpose`      text NOT NULL DEFAULT 'corporate',
  `enabled`      integer NOT NULL DEFAULT 1,
  `is_default`   integer NOT NULL DEFAULT 0,
  `created_at`   integer NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- vlan_id NULL is treated as distinct by SQLite, so multiple native rows are
-- allowed; tagged VLANs on the same base iface must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS `networks_iface_vlan_idx` ON `networks` (`iface`, `vlan_id`);

ALTER TABLE `dhcp_reservations` ADD COLUMN `network_id` integer REFERENCES `networks`(`id`);

-- On an upgrade the existing single dhcp_scope row becomes the default network.
-- On a fresh install dhcp_scope is still empty here (seed runs after migrate) —
-- this INSERT is then a no-op and seed.ts creates the default network instead.
-- rtrim() strips the trailing host octet from the gateway to derive a /24.
INSERT INTO `networks`
  (name, vlan_id, iface, subnet, gateway, dhcp_enabled, dhcp_start, dhcp_end,
   lease_time, dns_servers, domain, purpose, enabled, is_default)
SELECT 'Default LAN', NULL, 'eth1',
       rtrim(gateway, '0123456789') || '0/24', gateway,
       1, range_start, range_end, lease_time, dns_servers, domain,
       'corporate', 1, 1
FROM `dhcp_scope`
WHERE (SELECT COUNT(*) FROM `networks`) = 0
LIMIT 1;
