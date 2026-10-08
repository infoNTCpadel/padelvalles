// Autoritzacions de serveis per club: l'admin atorga crèdits (nº de torneos)
// o quota anual per servei ('inscripcions' | 'torneig'). El 'dashboard' és
// sempre gratuït i no necessita autorització.
import db from '../db.js';

const SERVEIS_PAGAMENT = ['inscripcions', 'torneig'];
const avui = () => new Date().toISOString().slice(0, 10);

function autoritzacioVigent(a) {
  if (!a || !a.actiu) return false;
  if (a.modalitat === 'anual') return (a.valid_fins || '') >= avui();
  return a.usats < a.quantitat; // 'credits'
}

// Totes les autoritzacions actives d'un club (per a l'admin i el panell del club)
export function autoritzacionsDe(clubId) {
  const rows = db.prepare(`SELECT * FROM club_serveis WHERE club_id = ? ORDER BY created_at DESC`).all(clubId);
  return rows.map(a => ({ ...a, vigent: autoritzacioVigent(a) }));
}

// Pot el club crear un NOU torneig amb aquest servei?
export function teDret(clubId, servei) {
  if (servei === 'dashboard') return true;
  if (!SERVEIS_PAGAMENT.includes(servei)) return false;
  return db.prepare(`SELECT * FROM club_serveis WHERE club_id = ? AND servei = ? AND actiu = 1`)
    .all(clubId, servei).some(autoritzacioVigent);
}

// Resum per club: { inscripcions: { ok, detall }, torneig: { ok, detall } }
// detall: text curt per mostrar ("3 de 5 disponibles", "anual fins al 08/10/2027", "sense autorització")
export function resumDrets(clubId) {
  const out = {};
  for (const servei of SERVEIS_PAGAMENT) {
    const auts = db.prepare(`SELECT * FROM club_serveis WHERE club_id = ? AND servei = ? AND actiu = 1`)
      .all(clubId, servei);
    const anual = auts.find(a => a.modalitat === 'anual' && autoritzacioVigent(a));
    const credits = auts.filter(a => a.modalitat === 'credits' && autoritzacioVigent(a));
    const disp = credits.reduce((n, a) => n + Math.max(0, a.quantitat - a.usats), 0);
    if (anual) {
      out[servei] = { ok: true, detall: `anual fins al ${(anual.valid_fins || '').split('-').reverse().join('/')}` };
    } else if (disp > 0) {
      out[servei] = { ok: true, detall: `${disp} torneig${disp === 1 ? '' : 's'} disponible${disp === 1 ? '' : 's'}` };
    } else {
      out[servei] = { ok: false, detall: 'sense autorització' };
    }
  }
  return out;
}

// Disponibilitat per a diversos clubs d'una vegada (formularis amb selector de club)
export function dretsPerClubs(clubIds) {
  const out = {};
  for (const id of clubIds || []) {
    const r = resumDrets(id);
    out[id] = { inscripcions: r.inscripcions.ok, torneig: r.torneig.ok };
  }
  return out;
}

// Consumeix 1 dret del servei (preferint quota anual abans que crèdits).
// Crida-la DINS d'una transacció junt amb el guardat del torneig.
// Retorna { ok } o { ok: false, error }.
export function consumeixDret(clubId, servei) {
  if (servei === 'dashboard') return { ok: true };
  const auts = db.prepare(`SELECT * FROM club_serveis WHERE club_id = ? AND servei = ? AND actiu = 1`)
    .all(clubId, servei);
  if (auts.some(a => a.modalitat === 'anual' && autoritzacioVigent(a))) return { ok: true };
  const ambCredit = auts.find(a => a.modalitat === 'credits' && autoritzacioVigent(a));
  if (!ambCredit) return { ok: false, error: `El club no té autorització per al servei «${servei}».` };
  db.prepare(`UPDATE club_serveis SET usats = usats + 1 WHERE id = ?`).run(ambCredit.id);
  return { ok: true };
}

// Allibera 1 dret consumit (p. ex. en baixar de servei en editar)
export function alliberaDret(clubId, servei) {
  if (servei === 'dashboard') return;
  const a = db.prepare(`SELECT * FROM club_serveis
    WHERE club_id = ? AND servei = ? AND actiu = 1 AND modalitat = 'credits' AND usats > 0
    ORDER BY created_at DESC LIMIT 1`).get(clubId, servei);
  if (a) db.prepare(`UPDATE club_serveis SET usats = usats - 1 WHERE id = ?`).run(a.id);
}
