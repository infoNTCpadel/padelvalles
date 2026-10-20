import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { sembraCandidats20260928 } from './seed-candidats-20260928.js';
import { sembraCandidats20261012 } from './seed-candidats-20261012.js';
import { sembraXarxes20261015 } from './seed-xarxes-20261015.js';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'padelvalles.db'));

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

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

-- Bústia de novetats: notes que els clubs envien (tornejos, canvis de dates,
-- ajornaments...). L'admin les modera; el cron d'Instagram llegeix les aprovades.
CREATE TABLE IF NOT EXISTS club_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  club_nom TEXT DEFAULT '',
  contacte TEXT DEFAULT '',
  tipus TEXT NOT NULL DEFAULT 'novetat',
  titol TEXT DEFAULT '',
  missatge TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendent',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolta_at TEXT
);

-- Monitors autoritzats per un club (veure inscrits + altes/baixes, sense gestionar el club)
CREATE TABLE IF NOT EXISTS club_monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (club_id, user_id)
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
  servei TEXT NOT NULL DEFAULT 'dashboard',
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

CREATE TABLE IF NOT EXISTS password_resets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
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
-- Organitzadors independents: perfil separat del de jugador (una persona pot
-- ser jugadora i organitzadora alhora). L'admin n'aprova el compte; els seus
-- tornejos trien un club seu, que els valida dins la plataforma.
CREATE TABLE IF NOT EXISTS organizers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  logo_path TEXT DEFAULT '',
  web TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_organizers_user ON organizers(user_id);
CREATE INDEX IF NOT EXISTS idx_organizers_status ON organizers(status);
-- Estat d'execució de les tasques programades internes
CREATE TABLE IF NOT EXISTS cron_state (
  clau TEXT PRIMARY KEY,
  valor TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fase 0 (mòdul de competicions): separar "torneig" (escaparate: cartell, dates,
-- inscripcions) de "competició" (jugable: format, quadres/grups, partits, classificació).
-- 1 categoria (modalitat + nivell) = 1 competició, amb selector de format per categoria.
-- Formats: 'eliminatoria' | 'rr_playoff' | 'americana' | 'equips' (+ futurs, motor enchufable).
-- Qui la pot crear: club | organizer (amb permís del club) | padelvalles (admin, pot saltar el permís).
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES tournament_categories(id) ON DELETE SET NULL,
  created_by_type TEXT NOT NULL DEFAULT 'club',   -- club | organizer | padelvalles
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  organizer_id INTEGER REFERENCES organizers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'eliminatoria',
  status TEXT NOT NULL DEFAULT 'draft',           -- draft | inscripcio | en_joc | finalitzada
  fee_text TEXT DEFAULT '',                       -- quota marcada des del principi (decisió 5)
  fee_amount REAL NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',              -- JSON: mida de grups, caps de sèrie, punts...
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Participants d'una competició: parella (pair), equip (team) o jugador individual (player, americana)
CREATE TABLE IF NOT EXISTS competition_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'pair',              -- pair | team | player
  player1_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  player2_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  player1_name TEXT DEFAULT '',
  player2_name TEXT DEFAULT '',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | active | withdrawn
  paid INTEGER NOT NULL DEFAULT 0,
  seed INTEGER,                                   -- cap de sèrie (NULL = sense)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Equips (competició d'equips): el club el gestiona o delega en un capità
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  captain_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,                -- quota per equip
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS team_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  player_name TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Grups de la fase de lliga
CREATE TABLE IF NOT EXISTS comp_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES comp_groups(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, entry_id)
);
-- Partits de la competició (disseny basat en la taula matches de la lliga social:
-- validació a 24 h, sets, STB, W.O.). tie_id = rubber dins d'un tie d'equips.
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'groups',           -- groups | bracket | americana
  round_no INTEGER,
  group_id INTEGER REFERENCES comp_groups(id) ON DELETE SET NULL,
  bracket_round TEXT,                             -- R128 | R64 | R32 | R16 | QF | SF | F
  bracket_slot INTEGER,
  seed_a INTEGER,
  seed_b INTEGER,
  entry_a_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  entry_b_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  tie_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  s1a INTEGER, s1b INTEGER,
  s2a INTEGER, s2b INTEGER,
  s3a INTEGER, s3b INTEGER,
  stb_a INTEGER, stb_b INTEGER,
  winner_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  wo_winner_id INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  unplayed INTEGER NOT NULL DEFAULT 0,
  submitted_by INTEGER REFERENCES competition_entries(id) ON DELETE SET NULL,
  submitted_at TEXT,
  validation TEXT NOT NULL DEFAULT 'none',       -- none | pending | validated | disputed | auto
  validation_deadline TEXT,
  notes TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Punts per jugador i partit (americana)
CREATE TABLE IF NOT EXISTS match_points (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  player_slot TEXT NOT NULL DEFAULT '',           -- a1 | a2 | b1 | b2
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, entry_id, player_slot)
);
-- Auditoria: qui genera quadres/grups i qui puja cada resultat
CREATE TABLE IF NOT EXISTS competition_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                           -- crear | generar_quadre | generar_grups | resultat | ...
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_torneig ON competitions(tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_comp_format ON competitions(format, status);
CREATE INDEX IF NOT EXISTS idx_entry_comp ON competition_entries(competition_id, status);
CREATE INDEX IF NOT EXISTS idx_teams_comp ON teams(competition_id);
CREATE INDEX IF NOT EXISTS idx_match_comp ON matches(competition_id, stage);
CREATE INDEX IF NOT EXISTS idx_match_bracket ON matches(competition_id, bracket_round, bracket_slot);
CREATE INDEX IF NOT EXISTS idx_audit_comp ON competition_audit(competition_id);
-- 1 categoria = 1 competició (els NULL permeten competicions sense torneig, p. ex. creades per l'admin)
CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_unic ON competitions(tournament_id, category_id);
`);

// Migracions idempotents per a BDs ja creades
for (const [taula, columna, def] of [
  ['tournaments', 'registration_mode', `TEXT NOT NULL DEFAULT 'externa'`],
  ['tournaments', 'registration_deadline', `TEXT DEFAULT ''`],
  ['tournaments', 'unregister_hours', `INTEGER DEFAULT 48`],
  ['tournaments', 'tipus', `TEXT DEFAULT 'open'`],
  ['tournament_categories', 'max_pairs', `INTEGER`],
  ['clubs', 'claim_token', `TEXT DEFAULT ''`],
  ['tournaments', 'mostra_inscrits', `INTEGER NOT NULL DEFAULT 1`],
  ['users', 'newsletter', `INTEGER NOT NULL DEFAULT 0`],
  ['tournaments', 'poster_path', `TEXT DEFAULT ''`],
  ['tournaments', 'organizer_id', `INTEGER REFERENCES organizers(id)`],
  ['clubs', 'instagram', `TEXT DEFAULT ''`],
  ['clubs', 'facebook', `TEXT DEFAULT ''`],
  ['clubs', 'x', `TEXT DEFAULT ''`],
  ['clubs', 'tiktok', `TEXT DEFAULT ''`],
  ['clubs', 'youtube', `TEXT DEFAULT ''`],
  ['competition_entries', 'registration_id', `INTEGER REFERENCES registrations(id) ON DELETE SET NULL`],
  ['registrations', 'player1_email', `TEXT DEFAULT ''`],
  ['registrations', 'player1_phone', `TEXT DEFAULT ''`],
  ['registrations', 'player2_email', `TEXT DEFAULT ''`],
  ['registrations', 'player2_phone', `TEXT DEFAULT ''`],
  ['matches', 'pista', `TEXT DEFAULT ''`],
  ['users', 'referral_code', `TEXT DEFAULT ''`],
  ['users', 'referred_by_id', `INTEGER REFERENCES users(id)`],
]) {
  const cols = db.prepare(`PRAGMA table_info(${taula})`).all();
  if (!cols.some(c => c.name === columna)) db.exec(`ALTER TABLE ${taula} ADD COLUMN ${columna} ${def}`);
}

// 2026-10-17: els participants de competició apunten a la inscripció (font única
// de veritat). Backfill únic per a BDs ja creades + retirada d'actius obsolets.
try {
  const __ceCols = db.prepare(`PRAGMA table_info(competition_entries)`).all().map(c => c.name);
  if (__ceCols.includes('registration_id')) {
    const __pendents = db.prepare(`SELECT COUNT(*) n FROM competition_entries WHERE registration_id IS NULL`).get().n;
    if (__pendents > 0) {
      const __clau = (a, b, n1, n2) => `${a ?? 'n'}/${b ?? 'n'}|${n1 || ''}|${n2 || ''}`;
      const __link = db.prepare(`UPDATE competition_entries SET registration_id = ? WHERE id = ?`);
      for (const comp of db.prepare(`SELECT id, category_id FROM competitions WHERE category_id IS NOT NULL`).all()) {
        const perClau = new Map();
        for (const r of db.prepare(`SELECT id, player1_id, player2_id, player1_name, player2_name
                                    FROM registrations WHERE category_id = ? ORDER BY id`).all(comp.category_id)) {
          perClau.set(__clau(r.player1_id, r.player2_id, r.player1_name, r.player2_name), r.id);
        }
        const usats = new Set();
        for (const e of db.prepare(`SELECT id, player1_id, player2_id, player1_name, player2_name
                                    FROM competition_entries
                                    WHERE competition_id = ? AND registration_id IS NULL`).all(comp.id)) {
          const rid = perClau.get(__clau(e.player1_id, e.player2_id, e.player1_name, e.player2_name));
          if (rid && !usats.has(rid)) { __link.run(rid, e.id); usats.add(rid); }
        }
      }
      // Les entries actives d'inscripcions que ja no són 'registered' passen a retirades
      db.exec(`UPDATE competition_entries SET status = 'withdrawn', seed = NULL
               WHERE status = 'active' AND registration_id IS NOT NULL
               AND (SELECT status FROM registrations r WHERE r.id = competition_entries.registration_id) != 'registered'`);
    }
  }
} catch (e) { console.error('[migracio] backfill registration_id:', e.message); }

// Autoritzacions de serveis per club (atorgades per l'admin).
// - modalitat 'credits': quantitat de torneos amb aquest servei (usats = consumits)
// - modalitat 'anual': torneos il·limitats fins a valid_fins (YYYY-MM-DD)
db.exec(`
CREATE TABLE IF NOT EXISTS club_serveis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  servei TEXT NOT NULL,
  modalitat TEXT NOT NULL DEFAULT 'credits',
  quantitat INTEGER NOT NULL DEFAULT 0,
  usats INTEGER NOT NULL DEFAULT 0,
  valid_fins TEXT DEFAULT '',
  actiu INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Sol·licituds d'accés als serveis de pagament (només clubs confirmats).
// La venda és personal (Mathius contacta amb preus); aquí queda el registre.
db.exec(`
CREATE TABLE IF NOT EXISTS servei_sollicituds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  servei TEXT NOT NULL DEFAULT 'inscripcions',
  tournament_id INTEGER REFERENCES tournaments(id),
  telefon TEXT DEFAULT '',
  missatge TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  gestionada_at TEXT
)`);

// Tornejos: servei contractat (dashboard | inscripcions | torneig).
// Migració dels existents: els d'inscripció a PadelVallès passen a 'inscripcions',
// excepte els que ja tenen competicions creades, que passen a 'torneig'.
{
  const cols = db.prepare('PRAGMA table_info(tournaments)').all().map(c => c.name);
  if (!cols.includes('servei')) {
    db.exec(`ALTER TABLE tournaments ADD COLUMN servei TEXT NOT NULL DEFAULT 'dashboard'`);
    db.exec(`UPDATE tournaments SET servei = 'inscripcions' WHERE registration_mode = 'padelvalles'`);
    try {
      db.exec(`UPDATE tournaments SET servei = 'torneig'
               WHERE id IN (SELECT DISTINCT tournament_id FROM competitions)`);
    } catch { /* la taula competitions encara no existeix */ }
  }
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

// Sembra idempotent de tornejos proposats per la cerca setmanal (pendents de revisió per l'admin)
sembraCandidats20260928(db);
sembraCandidats20261012(db);
sembraXarxes20261015(db);

// --- Calendari d'Advent (mòdul ocult: només accessible per la ruta directa
// /calendari; cap enllaç des del web, vegeu src/routes/advent.js) ---
// advent_days: contingut de cada casella (editable des de l'admin).
// advent_opens: una obertura per usuari i dia (UNIQUE).
// advent_entries: llibre auditable de participacions per al sorteig final
//   (source: open | quiz | referral | bonus; ref_key identifica l'origen únic:
//   id de l'amic als referits, 'ratxa-<dia>' als bonus; índex únic = idempotència).
// advent_draws: historial de sorteigs (diaris i final).
db.exec(`
CREATE TABLE IF NOT EXISTS advent_days (
  day INTEGER PRIMARY KEY,
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sponsor_name TEXT DEFAULT '',
  sponsor_url TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'premi',
  quiz_question TEXT DEFAULT '',
  quiz_options TEXT DEFAULT '[]',
  quiz_correct INTEGER DEFAULT 0,
  is_final INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS advent_opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  correct INTEGER,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, day)
);
CREATE TABLE IF NOT EXISTS advent_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  ref_key TEXT,
  points INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS advent_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  day INTEGER,
  winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entries_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_advent_opens_dia ON advent_opens(day);
CREATE INDEX IF NOT EXISTS idx_advent_entries_user ON advent_entries(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_advent_entries_refkey ON advent_entries(user_id, source, ref_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_advent_draws_dia ON advent_draws(scope, day);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_refcode ON users(referral_code) WHERE referral_code IS NOT NULL AND referral_code <> '';
`);

// Llavors dels 24 dies: premis provisionals, editables des de l'admin.
// El dia 12 és el premi especial de meitat de calendari; el 24, el gran premi
// final (secret a la comunicació: només se n'anuncia el valor, 180 €).
{
  const sembraDia = db.prepare(`INSERT OR IGNORE INTO advent_days
    (day, title, description, type, quiz_question, quiz_options, quiz_correct, is_final)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const Q = (p, opcions, correcta) => [p, JSON.stringify(opcions), correcta];
  const dies = [
    [1, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel per estrenar a la pista.', 'premi', '', '[]', 0, 0],
    [2, 'Mitjons de pádel', 'Uns mitjons tècnics de canya alta, dels que no rellisquen dins la sabatilla.', 'premi', '', '[]', 0, 0],
    [3, 'Pack de 3 grips', 'Tres grips per renovar l’empunyadura de la teva pala.', 'premi', '', '[]', 0, 0],
    [4, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel per a la propera americana.', 'premi', '', '[]', 0, 0],
    [5, 'Bidó esportiu', 'Un bidó esportiu per no quedar-te mai sense aigua entre jocs.', 'quiz', ...Q('Quants jugadors hi ha a la pista en un partit de pádel?', ['2', '4', '6'], 1), 0],
    [6, 'Protector de pala', 'Un protector transparent per allargar la vida del marc de la pala.', 'premi', '', '[]', 0, 0],
    [7, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel. Setmana 1 completada!', 'premi', '', '[]', 0, 0],
    [8, 'Gorra PadelVallès', 'Una gorra per als dies de sol a les pistes exteriors.', 'premi', '', '[]', 0, 0],
    [9, 'Tovallola de microfibra', 'Una tovallola de microfibra, petita i lleugera, per a la bossa de pádel.', 'premi', '', '[]', 0, 0],
    [10, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel per al cap de setmana.', 'premi', '', '[]', 0, 0],
    [11, 'Buf de pádel', 'Un buf tubular per als matins freds de desembre.', 'quiz', ...Q('Quin d’aquests cops es juga sense que la pelota boti?', ['La volea', 'La bandeja', 'La sortida de paret'], 0), 0],
    [12, 'Motxilla de pádel', 'PREMI ESPECIAL de meitat de calendari: una motxilla de pádel amb compartiment per a la pala.', 'premi', '', '[]', 0, 0],
    [13, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel per seguir sumant.', 'premi', '', '[]', 0, 0],
    [14, 'Pack de 2 botes de pelotas', 'Dos botes de 3 pelotas: un per a tu i un per a la teva parella de joc.', 'premi', '', '[]', 0, 0],
    [15, 'Mitjons tècnics', 'Uns mitjons tècnics de competició.', 'premi', '', '[]', 0, 0],
    [16, 'Canellera i grips', 'Una canellera i un pack de grips per jugar còmode.', 'premi', '', '[]', 0, 0],
    [17, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel. Ja queda poc per al gran dia!', 'premi', '', '[]', 0, 0],
    [18, 'Samarreta tècnica', 'Una samarreta tècnica transpirable per entrenar i competir.', 'quiz', ...Q('A quants sets es juga, com a màxim, un partit oficial de pádel?', ['2', '3', '5'], 1), 0],
    [19, 'Bote de pelotas', 'Un bote de 3 pelotas de pádel per a les festes.', 'premi', '', '[]', 0, 0],
    [20, 'Tovallola i protector', 'Una tovallola de microfibra i un protector de pala.', 'premi', '', '[]', 0, 0],
    [21, 'Bote de pelotas premium', 'Un bote de 3 pelotas premium, les de competició.', 'premi', '', '[]', 0, 0],
    [22, 'Pack d’accessoris', 'Grips, protector i mitjons: el kit complet d’accessoris.', 'premi', '', '[]', 0, 0],
    [23, 'Bote de pelotas i bidó', 'Un bote de 3 pelotas i un bidó esportiu. Demà, el gran dia!', 'premi', '', '[]', 0, 0],
    [24, 'Gran premi final', 'El gran premi del Calendari d’Advent, valorat en 180 €. El seu contingut es desvela avui, 24 de desembre. Molta sort!', 'premi', '', '[]', 0, 1],
  ];
  for (const d of dies) sembraDia.run(...d);
}

// Codis de referit per als usuaris que encara no en tenen (nous i existents)
{
  const senseCodi = db.prepare(`SELECT id FROM users WHERE referral_code IS NULL OR referral_code = ''`).all();
  if (senseCodi.length) {
    const existeix = db.prepare('SELECT 1 FROM users WHERE referral_code = ?');
    const upd = db.prepare('UPDATE users SET referral_code = ? WHERE id = ?');
    for (const u of senseCodi) {
      let codi;
      do { codi = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (existeix.get(codi));
      upd.run(codi, u.id);
    }
  }
}

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
