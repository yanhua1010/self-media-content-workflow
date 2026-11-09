// Local state for the workbench. One SQLite file, no external dependencies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = resolve(here, '..', 'data', 'workbench.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  http_status INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS radar_runs (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  params_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  collected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  angle TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  radar_run_id INTEGER REFERENCES radar_runs(id),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','picked','dropped')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER REFERENCES topics(id),
  platform TEXT NOT NULL,
  title TEXT,
  body TEXT,
  media_path TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','rejected')),
  review_note TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  content_id INTEGER NOT NULL REFERENCES contents(id),
  channel TEXT NOT NULL CHECK (channel IN ('aisa','wechat')),
  platform TEXT NOT NULL,
  account_id TEXT,
  remote_id TEXT,
  status TEXT NOT NULL,
  scheduled_for TEXT,
  timezone TEXT,
  url TEXT,
  last_response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

export function openDb(path = process.env.WORKBENCH_DB || DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
