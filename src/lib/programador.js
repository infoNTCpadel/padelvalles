// Tasques programades internes de PadelVallès.
// S'executen un cop al dia (~08:00 Europe/Madrid) mentre l'app està en marxa.
// No cal cron del sistema: el contenidor Docker sempre està actiu.
//
// - Millora 2: resum diari d'inscripcions per email als clubs.
// - Millora 3: recordatori als "m'interessa" 3 dies abans del tancament.

import db from '../db.js';
import { inscripcioOberta, inscripcioDe } from './inscripcions.js';
import { fmtDataCurta } from '../poster.js';
import { sendResumDiariClub, sendRecordatoriTancament } from '../mail.js';

const HORA_EXECUCIO = 8; // Europe/Madrid

function esc(s) { return String(s ?? '').replace(/</g, '&lt;'); }

function avuiMadrid() {
  const parts = new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function horaMadrid() {
  return Number(new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'Europe/Madrid', hour: 'numeric', hour12: false,
  }).format(new Date()));
}

function sumaDies(ymd, n) {
  const [Y, M, D] = String(ymd).split('-').map(Number);
  const d = new Date(Y, M - 1, D + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nomParella(r) {
  return `${r.nom1 || '?'} / ${r.nom2 || '?'}`;
}

function etiquetaCat(r) {
  const mods = { M: 'Masculí', F: 'Femení', X: 'Mixte' };
  return (mods[r.modality] || r.modality) + (r.level ? ' · ' + r.level : '');
}

// --- Millora 2: resum diari per al club ---
async function resumDiariClubs() {
  const tornejos = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.email AS club_email
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.registration_mode = 'padelvalles' AND t.status = 'published' AND t.ends_at >= date('now')
  `).all();
  // Agrupa per club
  const perClub = new Map();
  for (const t of tornejos) {
    if (!perClub.has(t.club_id)) perClub.set(t.club_id, { nom: t.club_nom, email: t.club_email, tornejos: [] });
    perClub.get(t.club_id).tornejos.push(t);
  }
  const q = `
    SELECT r.*, tc.modality, tc.level,
      COALESCE(u1.name, r.player1_name, '') AS nom1,
      COALESCE(u2.name, r.player2_name, '') AS nom2
    FROM registrations r
    JOIN tournament_categories tc ON tc.id = r.category_id
    LEFT JOIN users u1 ON u1.id = r.player1_id
    LEFT JOIN users u2 ON u2.id = r.player2_id
    WHERE r.tournament_id = ?`;
  for (const [clubId, dades] of perClub) {
    const linies = [];
    for (const t of dades.tornejos) {
      const noves = db.prepare(q + ` AND r.created_at >= datetime('now', '-1 day')
        AND r.status IN ('registered','waitlist','pending') ORDER BY r.created_at ASC`).all(t.id);
      const baixes = db.prepare(q + ` AND r.status = 'cancelled'
        AND r.decided_at >= datetime('now', '-1 day') ORDER BY r.decided_at ASC`).all(t.id);
      const pujades = db.prepare(q + ` AND r.status = 'registered'
        AND r.decided_at >= datetime('now', '-1 day')
        AND r.created_at < datetime('now', '-1 day') ORDER BY r.decided_at ASC`).all(t.id);
      if (noves.length) {
        linies.push(`<strong>«${esc(t.name)}»</strong>: ${noves.length} ${noves.length === 1 ? 'nova inscripció' : 'noves inscripcions'} — ` +
          noves.map(r => `${esc(nomParella(r))} (${esc(etiquetaCat(r))})`).join('; '));
      }
      if (pujades.length) {
        linies.push(`<strong>«${esc(t.name)}»</strong>: ${pujades.length} ${pujades.length === 1 ? 'parella puja' : 'parelles pugen'} de la llista d'espera — ` +
          pujades.map(r => esc(nomParella(r))).join('; '));
      }
      if (baixes.length) {
        linies.push(`<strong>«${esc(t.name)}»</strong>: ${baixes.length} ${baixes.length === 1 ? 'baixa' : 'baixes'} — ` +
          baixes.map(r => esc(nomParella(r))).join('; '));
      }
    }
    if (!linies.length) continue;
    // Destinataris: email del club + emails dels gestors
    const gestors = db.prepare(`
      SELECT u.name, u.email FROM club_users cu JOIN users u ON u.id = cu.user_id WHERE cu.club_id = ?`).all(clubId);
    const destins = new Map();
    if (dades.email) destins.set(dades.email.toLowerCase(), dades.nom);
    for (const g of gestors) if (g.email) destins.set(g.email.toLowerCase(), g.name);
    for (const [email, nom] of destins) {
      await sendResumDiariClub(email, nom, dades.nom, linies);
    }
    console.log(`[programador] resum diari enviat al club «${dades.nom}» (${destins.size} destinataris)`);
  }
}

// --- Millora 3: recordatori de tancament als "m'interessa" ---
async function recordatorisTancament() {
  const avui = avuiMadrid();
  const objectiu = sumaDies(avui, 3); // tanquen d'aquí a 3 dies
  const tornejos = db.prepare(`
    SELECT t.* FROM tournaments t
    WHERE t.registration_mode = 'padelvalles' AND t.status = 'published' AND t.ends_at >= date('now')
  `).all();
  for (const t of tornejos) {
    t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
    if (!inscripcioOberta({ ...t })) continue;
    // Data de tancament: la configurada, o el dia abans de l'inici si és buida
    const tancament = t.registration_deadline || sumaDies(t.starts_at, -1);
    if (tancament !== objectiu) continue;
    const interessats = db.prepare(`
      SELECT u.id, u.name, u.email FROM interests i JOIN users u ON u.id = i.user_id
      WHERE i.tournament_id = ? AND u.email_verified = 1`).all(t.id);
    let n = 0;
    for (const u of interessats) {
      if (inscripcioDe(t.id, u.id)) continue; // ja s'hi ha inscrit
      await sendRecordatoriTancament(u.email, u.name, t.name, t.id, fmtDataCurta(tancament));
      n++;
    }
    if (n) console.log(`[programador] recordatori de tancament: «${t.name}» (${n} avisos)`);
  }
}

async function tascaDiaria() {
  await resumDiariClubs();
  await recordatorisTancament();
}

export function arrencaProgramador() {
  const passa = async () => {
    try {
      const avui = avuiMadrid();
      const ultima = db.prepare(`SELECT valor FROM cron_state WHERE clau = 'programador_diari'`).get()?.valor;
      if (ultima === avui) return;      // ja s'ha executat avui
      if (horaMadrid() < HORA_EXECUCIO) return; // encara no toca
      await tascaDiaria();
      db.prepare(`INSERT INTO cron_state (clau, valor, updated_at) VALUES ('programador_diari', ?, datetime('now'))
        ON CONFLICT(clau) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now')`).run(avui);
    } catch (e) {
      console.error('[programador]', e.message);
    }
  };
  setInterval(passa, 30 * 60 * 1000).unref();
  passa(); // per si el contenidor ha arrencat després de l'hora
  console.log('[programador] tasques diàries actives (~08:00 Europe/Madrid)');
}

// Exportat per poder forçar l'execució en proves
export async function executaTascaDiaria() {
  await tascaDiaria();
}
