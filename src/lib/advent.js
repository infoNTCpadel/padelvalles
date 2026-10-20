// Calendari d'Advent: dates (Europe/Madrid), codis de referit, participacions,
// ratxes i sorteigs. Llibre de participacions: advent_entries (auditable).
//
// Punts (participacions per al gran sorteig final del dia 24):
//   obrir la casella del dia ......... +1 ('open')
//   encertar el quiz del dia ......... +1 ('quiz')
//   amic registrat i verificat ...... +2 ('referral', topall 10 amics)
//   ratxa de 7 dies consecutius ...... +2 ('bonus', una vegada per ratxa)
import crypto from 'node:crypto';
import db, { transaccio } from '../db.js';

export const VALOR_GRAN_PREMI = 180; // € anunciats; el premi concret és secret
export const PUNTS_REFERIT = 2;
export const MAX_REFERITS = 10;
export const PUNTS_RATXA = 2;
export const DIES_RATXA = 7;
const INICI = '2026-12-01';
const FI = '2026-12-24';

// Data d'avui a Europe/Madrid ('YYYY-MM-DD'). ADVENT_SIM_DATE permet simular
// el dia en entorns de prova (p. ex. ADVENT_SIM_DATE=2026-12-05).
export function dataAvui() {
  const sim = String(process.env.ADVENT_SIM_DATE || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(sim)) return sim;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Fase del calendari: abans (dia 0), durant (dia 1-24) o després (dia 25)
export function estatCalendari() {
  const d = dataAvui();
  if (d < INICI) return { fase: 'abans', dia: 0, data: d };
  if (d > FI) return { fase: 'despres', dia: 25, data: d };
  return { fase: 'durant', dia: parseInt(d.slice(8, 10), 10), data: d };
}

function generaCodi() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Codi de referit de l'usuari; el genera i el desa si encara no en té
export function codiReferitDe(userId) {
  const u = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId);
  if (!u) return '';
  if (u.referral_code) return u.referral_code;
  const existeix = db.prepare('SELECT 1 FROM users WHERE referral_code = ?');
  let codi;
  do { codi = generaCodi(); } while (existeix.get(codi));
  db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(codi, userId);
  return codi;
}

// Usuari amfitrió a partir d'un codi de referit (o null si no és vàlid)
export function usuariPerCodiReferit(codi) {
  const c = String(codi || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(c)) return null;
  return db.prepare('SELECT id, name FROM users WHERE referral_code = ?').get(c) || null;
}

export function totalParticipacions(userId) {
  return db.prepare('SELECT COALESCE(SUM(points), 0) n FROM advent_entries WHERE user_id = ?').get(userId).n;
}

export function afegeixParticipacio(userId, source, points, refKey = null) {
  db.prepare('INSERT INTO advent_entries (user_id, source, ref_key, points) VALUES (?, ?, ?, ?)')
    .run(userId, source, refKey, points);
}

// Abona +2 al referent quan un usuari convidat verifica el seu email.
// Idempotent (índex únic per ref_key + comprovació prèvia) i amb topall.
export function abonaReferit(amicId) {
  try {
    return transaccio(() => {
      const amic = db.prepare('SELECT id, referred_by_id, email_verified FROM users WHERE id = ?').get(amicId);
      if (!amic || !amic.referred_by_id || !amic.email_verified) return false;
      const refId = amic.referred_by_id;
      if (refId === amic.id) return false;
      const refKey = String(amic.id);
      const ja = db.prepare(`SELECT 1 FROM advent_entries WHERE user_id = ? AND source = 'referral' AND ref_key = ?`)
        .get(refId, refKey);
      if (ja) return false;
      const n = db.prepare(`SELECT COUNT(*) n FROM advent_entries WHERE user_id = ? AND source = 'referral'`).get(refId).n;
      if (n >= MAX_REFERITS) return false;
      afegeixParticipacio(refId, 'referral', PUNTS_REFERIT, refKey);
      return true;
    });
  } catch { return false; /* l'abonament mai no ha de trencar la verificació */ }
}

// Bonus de ratxa: si en obrir el dia `dia` l'usuari completa una ratxa de
// 7 dies consecutius (o múltiple), +2 una sola vegada per ratxa.
export function comprovaRatxa(userId, dia) {
  const oberts = new Set(db.prepare('SELECT day FROM advent_opens WHERE user_id = ?').all(userId).map(x => x.day));
  let ratxa = 0;
  for (let d = dia; oberts.has(d); d--) ratxa++;
  if (ratxa === 0 || ratxa % DIES_RATXA !== 0) return false;
  const refKey = 'ratxa-' + dia;
  const ja = db.prepare(`SELECT 1 FROM advent_entries WHERE user_id = ? AND source = 'bonus' AND ref_key = ?`)
    .get(userId, refKey);
  if (ja) return false;
  afegeixParticipacio(userId, 'bonus', PUNTS_RATXA, refKey);
  return true;
}

// Classificació pública per participacions totals
export function ranquing(limit = 10) {
  return db.prepare(`
    SELECT u.name, SUM(e.points) AS pts FROM advent_entries e
    JOIN users u ON u.id = e.user_id
    GROUP BY e.user_id ORDER BY pts DESC, MIN(e.id) ASC LIMIT ?`).all(limit);
}

// Sorteig diari: un guanyador entre qui ha obert la casella d'aquell dia
export function sorteigDiari(dia) {
  const d = parseInt(dia, 10);
  if (!Number.isInteger(d) || d < 1 || d > 24) return { error: 'Dia no vàlid.' };
  const ja = db.prepare(`SELECT id FROM advent_draws WHERE scope = 'daily' AND day = ?`).get(d);
  if (ja) return { error: `El dia ${d} ja té guanyador.` };
  const oberts = db.prepare('SELECT user_id FROM advent_opens WHERE day = ?').all(d);
  if (!oberts.length) return { error: `El dia ${d} encara no té cap obertura.` };
  const guanyador = oberts[crypto.randomInt(oberts.length)].user_id;
  db.prepare(`INSERT INTO advent_draws (scope, day, winner_user_id, entries_count) VALUES ('daily', ?, ?, ?)`)
    .run(d, guanyador, oberts.length);
  return { ok: true, winner: guanyador, entries: oberts.length };
}

// Gran sorteig final: ponderat per participacions (totes les entrades compten)
export function sorteigFinal() {
  const ja = db.prepare(`SELECT id FROM advent_draws WHERE scope = 'final'`).get();
  if (ja) return { error: 'El sorteig final ja s’ha fet.' };
  const files = db.prepare(`SELECT user_id, SUM(points) AS pts FROM advent_entries GROUP BY user_id`).all();
  const total = files.reduce((s, f) => s + f.pts, 0);
  if (!total) return { error: 'Encara no hi ha cap participació.' };
  let tiquet = crypto.randomInt(total);
  let guanyador = files[files.length - 1].user_id;
  for (const f of files) {
    if (tiquet < f.pts) { guanyador = f.user_id; break; }
    tiquet -= f.pts;
  }
  db.prepare(`INSERT INTO advent_draws (scope, day, winner_user_id, entries_count) VALUES ('final', NULL, ?, ?)`)
    .run(guanyador, total);
  return { ok: true, winner: guanyador, entries: total };
}
