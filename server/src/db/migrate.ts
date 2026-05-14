import fs from 'node:fs';
import path from 'node:path';
import { sqlite } from './client';
import { log } from '../logger';

const migrationsDir = path.join(__dirname, 'migrations');

function ensureMigrationsTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
}

function applied(name: string): boolean {
  const row = sqlite.prepare('SELECT name FROM __migrations WHERE name = ?').get(name);
  return !!row;
}

function apply(name: string, sql: string) {
  const tx = sqlite.transaction(() => {
    sqlite.exec(sql);
    sqlite.prepare('INSERT INTO __migrations (name) VALUES (?)').run(name);
  });
  tx();
}

export function runMigrations() {
  ensureMigrationsTable();
  if (!fs.existsSync(migrationsDir)) {
    log.warn({ migrationsDir }, 'migrations dir missing');
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    log.info({ migration: f }, 'applying');
    apply(f, sql);
  }
  log.info({ count: files.length }, 'migrations done');
}

if (require.main === module) {
  runMigrations();
  process.exit(0);
}
