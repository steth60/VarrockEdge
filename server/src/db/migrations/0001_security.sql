CREATE TABLE IF NOT EXISTS `detection_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `severity` text NOT NULL,
  `threshold` text NOT NULL,
  `action` text NOT NULL,
  `hits` integer DEFAULT 0 NOT NULL,
  `builtin` integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS `threats` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `rule_id` text NOT NULL,
  `severity` text NOT NULL,
  `kind` text NOT NULL,
  `src` text NOT NULL,
  `dst` text NOT NULL,
  `count` integer DEFAULT 1 NOT NULL,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `status` text DEFAULT 'monitoring' NOT NULL,
  `country` text,
  `desc` text
);
CREATE INDEX IF NOT EXISTS `threats_rule_src_idx` ON `threats` (`rule_id`, `src`);
CREATE INDEX IF NOT EXISTS `threats_last_seen_idx` ON `threats` (`last_seen_at`);

CREATE TABLE IF NOT EXISTS `event_buckets` (
  `hour` integer PRIMARY KEY NOT NULL,
  `critical` integer DEFAULT 0 NOT NULL,
  `high` integer DEFAULT 0 NOT NULL,
  `medium` integer DEFAULT 0 NOT NULL,
  `low` integer DEFAULT 0 NOT NULL
);
