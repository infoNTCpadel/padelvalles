import db from '../db.js';

export const ESTATS_ACTIUS = ['pending', 'registered', 'waitlist'];

// La inscripció en línia està oberta per a aquest torneig?
export function inscripcioOberta(t) {
  if (!t || (t.registration_mode || 'externa') !== 'padelvalles') return false;
  if (t.status !== 'published') return false;
  const avui = new Date().toISOString().slice(0, 10);
  if (t.ends_at < avui) return false;
  if (t.registration_deadline && avui > t.registration_deadline) return false;
  return true;
}

// Places lliures d'una categoria (null = sense límit)
export function placesCategoria(catId) {
  const cat = db.prepare('SELECT max_pairs FROM tournament_categories WHERE id = ?').get(catId);
  if (!cat || cat.max_pairs == null) return null;
  const n = db.prepare(
    `SELECT COUNT(*) n FROM registrations WHERE category_id = ? AND status = 'registered'`).get(catId).n;
  return Math.max(0, cat.max_pairs - n);
}

// Inscripció activa (pending/registered/waitlist) d'un usuari en un torneig
export function inscripcioDe(torneigId, userId) {
  return db.prepare(`
    SELECT r.*, tc.modality, tc.level
    FROM registrations r JOIN tournament_categories tc ON tc.id = r.category_id
    WHERE r.tournament_id = ? AND (r.player1_id = ? OR r.player2_id = ?)
      AND r.status IN ('pending','registered','waitlist')
    ORDER BY r.id DESC LIMIT 1`).get(torneigId, userId, userId);
}

// Pot l'usuari donar-se de baixa ell mateix? (dins el termini del club)
export function potDesapuntar(t) {
  const hores = Number(t.unregister_hours ?? 48);
  if (!t.starts_at) return false;
  const limit = new Date(t.starts_at + 'T00:00:00').getTime() - hores * 3600e3;
  return Date.now() < limit;
}

// Promou el primer de la llista d'espera a inscrit; retorna la inscripció promoguda o null
export function promouLlistaEspera(torneigId, categoriaId) {
  const seg = db.prepare(`
    SELECT * FROM registrations
    WHERE tournament_id = ? AND category_id = ? AND status = 'waitlist'
    ORDER BY decided_at ASC, id ASC LIMIT 1`).get(torneigId, categoriaId);
  if (!seg) return null;
  const lliures = placesCategoria(categoriaId);
  if (lliures !== null && lliures < 1) return null;
  db.prepare(`UPDATE registrations SET status = 'registered', decided_at = datetime('now') WHERE id = ?`).run(seg.id);
  return { ...seg, status: 'registered' };
}

// Compta tornejos del club amb inscripció a PadelVallès (per a l'avís de quota)
export function comptaAmbInscripcio(clubId, exclouId = null) {
  const rows = db.prepare(`
    SELECT id FROM tournaments WHERE club_id = ? AND registration_mode = 'padelvalles'`).all(clubId);
  return rows.filter(r => String(r.id) !== String(exclouId)).length;
}
