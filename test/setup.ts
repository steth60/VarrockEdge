// Vitest global setup — runs once before any test module is loaded.
// Sets the env so server modules pick up a fresh in-memory SQLite DB.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varrok-test-'));

process.env.VE_DB_PATH = path.join(tmpDir, 'test.db');
process.env.VE_CONFIG_DIR = tmpDir;
process.env.VE_BIND_HOST = '127.0.0.1';
process.env.VE_PORT = '0';
process.env.VE_ADMIN_PASSWORD = 'test-password-123';
process.env.VE_SESSION_SECRET = 'test-session-secret-32-bytes-or-more';
process.env.VE_WAN_IFACE = 'eth0';
process.env.VE_LAN_IFACE = 'eth1';
process.env.VE_LOG_LEVEL = 'silent';
