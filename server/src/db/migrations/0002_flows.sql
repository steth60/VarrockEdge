CREATE TABLE IF NOT EXISTS `flow_top_clients` (
  `window`     text NOT NULL,                 -- '1m' | '1h' | '24h'
  `src_ip`     text NOT NULL,
  `host_hint`  text,
  `packets`    integer NOT NULL DEFAULT 0,
  `bytes`      integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`window`, `src_ip`)
);

CREATE TABLE IF NOT EXISTS `flow_top_services` (
  `window`     text NOT NULL,
  `dport`      integer NOT NULL,
  `proto`      text NOT NULL,
  `packets`    integer NOT NULL DEFAULT 0,
  `bytes`      integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`window`, `dport`, `proto`)
);

CREATE TABLE IF NOT EXISTS `flow_top_destinations` (
  `window`       text NOT NULL,
  `dst_ip`       text NOT NULL,
  `country_hint` text,
  `packets`      integer NOT NULL DEFAULT 0,
  `bytes`        integer NOT NULL DEFAULT 0,
  `updated_at`   integer NOT NULL,
  PRIMARY KEY (`window`, `dst_ip`)
);

CREATE TABLE IF NOT EXISTS `flow_apps` (
  `window`     text NOT NULL,
  `app`        text NOT NULL,
  `down_bytes` integer NOT NULL DEFAULT 0,
  `up_bytes`   integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`window`, `app`)
);

CREATE TABLE IF NOT EXISTS `latency_buckets` (
  `minute`    integer PRIMARY KEY NOT NULL,    -- Math.floor(epochMs / 60000)
  `avg_ms`    real,
  `loss_pct`  real
);

CREATE TABLE IF NOT EXISTS `availability_buckets` (
  `target`     text NOT NULL,                  -- 'wan' | 'wg:<id>'
  `bucket`     integer NOT NULL,               -- Math.floor(epochMs / (15*60_000))
  `status`     text NOT NULL,                  -- 'up' | 'degraded' | 'down'
  PRIMARY KEY (`target`, `bucket`)
);
