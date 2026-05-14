CREATE TABLE IF NOT EXISTS `speedtest_runs` (
  `id`            integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ts`            integer NOT NULL,
  `download_mbps` real NOT NULL,
  `upload_mbps`   real NOT NULL,
  `ping_ms`       real NOT NULL,
  `isp`           text,
  `server`        text,
  `source`        text NOT NULL,         -- 'ookla' | 'synthetic'
  `trigger`       text NOT NULL DEFAULT 'manual'  -- 'manual' | 'scheduled'
);

CREATE INDEX IF NOT EXISTS `speedtest_runs_ts_idx` ON `speedtest_runs` (`ts`);
