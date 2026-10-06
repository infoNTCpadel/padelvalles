// Mòdul de competicions (Fase 1): separar "torneig" (escaparate) de "competició" (jugable).
// 1 categoria (modalitat + nivell) = 1 competició, amb selector de format per categoria.
//
// Registre de formats (motor enchufable): cada format implementarà generar(),
// validarConfig() i calcularClassificacio() (Fase 2). Ordre decidit:
// eliminatoria → rr_playoff → americana (+ més formats després).
import db, { transaccio } from '../db.js';
import { MODALITATS } from '../brand.js';

export const FORMATS = {
  eliminatoria: {
    nom: 'Eliminatòria', actiu: true,
    descripcio: 'Quadre a eliminació directa amb caps de sèrie i byes automàtics.'
  },
  rr_playoff: {
    nom: 'Round robin + playoff', actiu: false,
    descripcio: 'Lligueta per grups + quadre final. (Properament)'
  },
  americana: {
    nom: 'Americana', actiu: false,
    descripcio: 'Inscripció individual, parelles rotatòries i rànquing per punts. (Properament)'
  },
  equips: {
    nom: 'Equips', actiu: false,
    descripcio: 'Competició d\u2019equips impulsada per PadelVallès. (Properament)'
  },
};

export const ESTATS_COMPETICIO = {
  draft: 'Esborrany',
  inscripcio: 'Inscripció',
  en_joc: 'En joc',
  finalitzada: 'Finalitzada',
};

// Qui pot crear/gestionar la competició d'un torneig?
// - admin → 'padelvalles' (pot saltar-se el permís del club)
// - gestor del club → 'club'
// - organitzador del torneig (el club ja li ha validat el torneig) → 'organizer'
// Retorna { tipus, club_id, organizer_id } o null.
export function resolCreador(user, t, { esGestor = false, organitzador = null } = {}) {
  if (!user || !t) return null;
  if (user.role === 'admin') return { tipus: 'padelvalles', club_id: t.club_id, organizer_id: null };
  if (esGestor) return { tipus: 'club', club_id: t.club_id, organizer_id: null };
  if (organitzador && t.organizer_id === organitzador.id &&
      !['pending_club', 'rejected'].includes(t.status)) {
    return { tipus: 'organizer', club_id: t.club_id, organizer_id: organitzador.id };
  }
  return null;
}

// Competicions d'un torneig: { totes, perCat: { categoryId: competicio } }
export function competicionsDe(torneigId) {
  const totes = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM competition_entries e
        WHERE e.competition_id = c.id AND e.status = 'active') AS n_actius
    FROM competitions c WHERE c.tournament_id = ? ORDER BY c.id`).all(torneigId);
  const perCat = {};
  for (const c of totes) if (c.category_id) perCat[c.category_id] = c;
  return { totes, perCat };
}

function clauParella(p1id, p2id, n1, n2) {
  return `${p1id ?? 'n'}/${p2id ?? 'n'}|${n1 || ''}|${n2 || ''}`;
}

// Importa les inscripcions 'registered' d'una categoria com a participants.
// Idempotent: no duplica les que ja hi són.
export function importaInscrits(competitionId, categoryId) {
  const existents = new Set(db.prepare(
    `SELECT * FROM competition_entries WHERE competition_id = ? AND kind = 'pair'`)
    .all(competitionId).map(e => clauParella(e.player1_id, e.player2_id, e.player1_name, e.player2_name)));
  const regs = db.prepare(`
    SELECT * FROM registrations
    WHERE category_id = ? AND status = 'registered'
    ORDER BY decided_at ASC, id ASC`).all(categoryId);
  const ins = db.prepare(`INSERT INTO competition_entries
    (competition_id, kind, player1_id, player2_id, player1_name, player2_name, status, paid)
    VALUES (?, 'pair', ?, ?, ?, ?, 'active', ?)`);
  let n = 0;
  for (const reg of regs) {
    const k = clauParella(reg.player1_id, reg.player2_id, reg.player1_name, reg.player2_name);
    if (existents.has(k)) continue;
    ins.run(competitionId, reg.player1_id, reg.player2_id,
      reg.player1_name || '', reg.player2_name || '', reg.paid ? 1 : 0);
    existents.add(k);
    n++;
  }
  return n;
}

// Crea la competició d'una categoria i hi converteix les inscripcions confirmades.
export function creaCompeticio({ tournament_id, category_id, format, name, fee_text, fee_amount, creador, actorId }) {
  if (!FORMATS[format] || !FORMATS[format].actiu) throw new Error('Aquest format encara no està disponible.');
  const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ? AND tournament_id = ?')
    .get(category_id, tournament_id);
  if (!cat) throw new Error('Categoria no vàlida.');
  const ja = db.prepare('SELECT id FROM competitions WHERE tournament_id = ? AND category_id = ?')
    .get(tournament_id, category_id);
  if (ja) throw new Error('Aquesta categoria ja té una competició creada.');
  if (!creador) throw new Error('No tens permís per crear competicions en aquest torneig.');
  let nom = String(name || '').trim().slice(0, 120);
  if (!nom) {
    nom = `${MODALITATS[cat.modality] || cat.modality}${cat.level ? ' · ' + cat.level : ''} — ${FORMATS[format].nom}`;
  }
  return transaccio(() => {
    const comp = db.prepare(`INSERT INTO competitions
      (tournament_id, category_id, created_by_type, club_id, organizer_id, name, format, status, fee_text, fee_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inscripcio', ?, ?)`).run(
      tournament_id, category_id, creador.tipus, creador.club_id, creador.organizer_id,
      nom, format, String(fee_text || '').slice(0, 80), Math.max(0, Number(fee_amount) || 0));
    const cid = comp.lastInsertRowid;
    const n = importaInscrits(cid, category_id);
    db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail)
                VALUES (?, ?, 'crear', ?)`)
      .run(cid, actorId || null, `format=${format}; categoria=${category_id}; importades=${n}`);
    return { id: cid, importades: n };
  });
}

export function agafaCompeticio(competitionId, torneigId) {
  return db.prepare('SELECT * FROM competitions WHERE id = ? AND tournament_id = ?')
    .get(competitionId, torneigId) || null;
}

export function participantsDe(competitionId, inclouBaixes = false) {
  return db.prepare(`
    SELECT * FROM competition_entries
    WHERE competition_id = ? ${inclouBaixes ? '' : "AND status = 'active'"}
    ORDER BY CASE WHEN seed IS NULL THEN 1 ELSE 0 END, seed ASC, id ASC`).all(competitionId);
}

export function fixaSeed(entryId, competitionId, seed) {
  const s = String(seed ?? '').trim() === '' ? null : Math.max(1, Math.min(512, parseInt(seed, 10) || 0)) || null;
  // Evita duplicats de cap de sèrie dins la mateixa competició
  if (s !== null) {
    const dup = db.prepare(`SELECT id FROM competition_entries
      WHERE competition_id = ? AND seed = ? AND id != ? AND status = 'active'`).get(competitionId, s, entryId);
    if (dup) throw new Error(`El cap de sèrie ${s} ja està assignat a una altra parella.`);
  }
  db.prepare('UPDATE competition_entries SET seed = ? WHERE id = ? AND competition_id = ?')
    .run(s, entryId, competitionId);
}

export function canviaEstatParticipant(entryId, competitionId, nouEstat) {
  if (!['active', 'withdrawn'].includes(nouEstat)) throw new Error('Estat no vàlid.');
  db.prepare(`UPDATE competition_entries SET status = ?, seed = CASE WHEN ? = 'withdrawn' THEN NULL ELSE seed END
              WHERE id = ? AND competition_id = ?`).run(nouEstat, nouEstat, entryId, competitionId);
}

export function commutaPagatParticipant(entryId, competitionId) {
  const e = db.prepare('SELECT paid FROM competition_entries WHERE id = ? AND competition_id = ?')
    .get(entryId, competitionId);
  if (!e) throw new Error('Participant no trobat.');
  db.prepare('UPDATE competition_entries SET paid = ? WHERE id = ? AND competition_id = ?')
    .run(e.paid ? 0 : 1, entryId, competitionId);
}
