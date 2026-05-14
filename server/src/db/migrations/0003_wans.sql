CREATE TABLE IF NOT EXISTS `wan_interfaces` (
  `id`            integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `iface`         text NOT NULL UNIQUE,
  `label`         text NOT NULL,
  `role`          text DEFAULT 'primary' NOT NULL,
  `priority`      integer DEFAULT 100 NOT NULL,
  `health_target` text DEFAULT '1.1.1.1' NOT NULL,
  `enabled`       integer DEFAULT 1 NOT NULL,
  `created_at`    integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);

CREATE TABLE IF NOT EXISTS `wan_health` (
  `iface`    text NOT NULL,
  `ts`       integer NOT NULL,
  `status`   text NOT NULL,
  `rtt_ms`   real,
  `loss_pct` real,
  PRIMARY KEY (`iface`, `ts`)
);
CREATE INDEX IF NOT EXISTS `wan_health_ts_idx` ON `wan_health` (`ts`);
