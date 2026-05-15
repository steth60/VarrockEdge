-- Per-network opt-in for UPnP IGD / NAT-PMP. Off by default — UPnP requests
-- are only honoured on networks that explicitly allow it.
ALTER TABLE `networks` ADD COLUMN `upnp_allowed` integer NOT NULL DEFAULT 0;
