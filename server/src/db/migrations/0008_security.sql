-- Auth hardening: forced first-login password change + per-account lockout.
ALTER TABLE `users` ADD COLUMN `must_change_password` integer DEFAULT 0 NOT NULL;
ALTER TABLE `users` ADD COLUMN `failed_count` integer DEFAULT 0 NOT NULL;
ALTER TABLE `users` ADD COLUMN `locked_until` integer;

-- Existing deployments: force the seeded admin to set a real password on next
-- sign-in (the original may still be the install-time default).
UPDATE `users` SET `must_change_password` = 1 WHERE `email` = 'admin@varrok.local';
