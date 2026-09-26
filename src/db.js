import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'padelvalles.db'));

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  level TEXT DEFAULT '',
  home_club_id INTEGER REFERENCES clubs(id),
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  town TEXT NOT NULL,
  comarca TEXT NOT NULL DEFAULT 'occidental',
  address TEXT DEFAULT '',
  website TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  description TEXT DEFAULT '',
  logo_path TEXT DEFAULT '',
  courts INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS club_users (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, club_id)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  price_text TEXT DEFAULT '',
  registration_info TEXT DEFAULT '',
  registration_url TEXT DEFAULT '',
  registration_mode TEXT NOT NULL DEFAULT 'externa',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  reject_reason TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS tournament_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  modality TEXT NOT NULL,
  level TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS interests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, tournament_id)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, club_id)
);

CREATE TABLE IF NOT EXISTS email_tokens (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT DEFAULT '',
  target_id INTEGER,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  reporter_email TEXT DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_tournaments_club ON tournaments(club_id);
CREATE INDEX IF NOT EXISTS idx_clubs_comarca ON clubs(comarca);

-- Fase 2: inscripcions dins la plataforma
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  player1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  player1_name TEXT DEFAULT '',
  player2_name TEXT DEFAULT '',
  added_by_club INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reg_torneig ON registrations(tournament_id, status);
CREATE TABLE IF NOT EXISTS partner_search (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modality TEXT NOT NULL,
  level TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tournament_id, user_id)
);
-- Sol·licituds de gestió d'un club (pendents d'aprovació de l'admin)
CREATE TABLE IF NOT EXISTS club_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
-- Estat d'execució de les tasques programades internes
CREATE TABLE IF NOT EXISTS cron_state (
  clau TEXT PRIMARY KEY,
  valor TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migracions idempotents per a BDs ja creades
for (const [taula, columna, def] of [
  ['tournaments', 'registration_mode', `TEXT NOT NULL DEFAULT 'externa'`],
  ['tournaments', 'registration_deadline', `TEXT DEFAULT ''`],
  ['tournaments', 'unregister_hours', `INTEGER DEFAULT 48`],
  ['tournaments', 'tipus', `TEXT DEFAULT 'open'`],
  ['tournament_categories', 'max_pairs', `INTEGER`],
  ['clubs', 'claim_token', `TEXT DEFAULT ''`],
]) {
  const cols = db.prepare(`PRAGMA table_info(${taula})`).all();
  if (!cols.some(c => c.name === columna)) db.exec(`ALTER TABLE ${taula} ADD COLUMN ${columna} ${def}`);
}

// Migració: parelles apuntades manualment pel club (jugadors sense compte).
// Cal reconstruir la taula perquè player1_id/player2_id passen a ser NULLables.
{
  const cols = db.prepare('PRAGMA table_info(registrations)').all().map(c => c.name);
  if (!cols.includes('player1_name')) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE registrations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
          category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
          player1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          player1_name TEXT DEFAULT '',
          player2_name TEXT DEFAULT '',
          added_by_club INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          paid INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          decided_at TEXT
        );
        INSERT INTO registrations_new
          (id, tournament_id, category_id, player1_id, player2_id, status, paid, created_at, decided_at)
          SELECT id, tournament_id, category_id, player1_id, player2_id, status, paid, created_at, decided_at
          FROM registrations;
        DROP TABLE registrations;
        ALTER TABLE registrations_new RENAME TO registrations;
        CREATE INDEX IF NOT EXISTS idx_reg_torneig ON registrations(tournament_id, status);
        UPDATE registrations
          SET player1_name = (SELECT name FROM users WHERE users.id = registrations.player1_id),
              player2_name = (SELECT name FROM users WHERE users.id = registrations.player2_id);
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

// --- Correccions i millores 2026-09-26 (2a tongada) ---
// Telèfon del jugador (visible per al club organitzador)
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('phone')) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`);
  }
}
// «Busco parella» amb categoria real del torneig
{
  const cols = db.prepare('PRAGMA table_info(partner_search)').all().map(c => c.name);
  if (!cols.includes('category_id')) {
    db.exec(`ALTER TABLE partner_search ADD COLUMN category_id INTEGER REFERENCES tournament_categories(id) ON DELETE CASCADE`);
  }
}
// Tipus de torneig: només Federat / Open (els 'circuit' passen a 'open')
db.exec(`UPDATE tournaments SET tipus = 'open' WHERE tipus = 'circuit'`);
// Nivells antics (text lliure) -> nous identificadors de l'escala de 7 nivells
db.exec(`UPDATE users SET level = CASE level
  WHEN 'Iniciació' THEN 'iniciacio'
  WHEN 'Intermig' THEN 'intermedi'
  WHEN 'Avançat' THEN 'intermedi-avancat'
  WHEN 'Competició' THEN 'competicio'
  ELSE '' END
  WHERE level NOT IN ('iniciacio','principiant','intermedi-iniciacio','intermedi','intermedi-alt','intermedi-avancat','competicio')`);

// Índexs essencials: cerques per jugador en inscripcions, anuncis i sol·licituds
db.exec(`CREATE INDEX IF NOT EXISTS idx_reg_p1 ON registrations(tournament_id, player1_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_reg_p2 ON registrations(tournament_id, player2_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ps_torneig ON partner_search(tournament_id, status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_club ON club_claims(club_id, status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_interests_t ON interests(tournament_id)`);

// Transacció: tot o res. Si alguna ordre falla, es desfà tot el bloc.
export function transaccio(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ja s'ha desfet */ }
    throw e;
  }
}

export default db;
