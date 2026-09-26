import { Router } from 'express';
import db from '../db.js';
import { requireLogin, requireVerified } from '../middleware.js';
import { MODALITATS } from '../brand.js';
import {
  inscripcioOberta, placesCategoria, inscripcioDe, potDesapuntar, promouLlistaEspera,
} from '../lib/inscripcions.js';
import {
  sendInvitacioParella, sendInvitacioAcceptada, sendInvitacioRebutjada,
  sendInscripcioConfirmada, sendPromocioEspera,
} from '../mail.js';

const r = Router();
const juga = [requireLogin, requireVerified];

function getTorneig(id) {
  const t = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble, c.comarca, c.logo_path
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.id = ?`).get(id);
  if (!t) return null;
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  return t;
}

function etiqueta(cat) {
  return (MODALITATS[cat.modality] || cat.modality) + (cat.level ? ' · ' + cat.level : '');
}

function torna(res, tid, avis, error) {
  let url = `/torneig/${tid}`;
  const q = [];
  if (avis) q.push('avis=' + avis);
  if (error) q.push('error=' + encodeURIComponent(error));
  if (q.length) url += '?' + q.join('&');
  return res.redirect(url);
}

function parellaDe(insc) {
  return {
    p1: db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(insc.player1_id),
    p2: db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(insc.player2_id),
  };
}

// --- Inscriure la parella: el jugador 1 convida el jugador 2 per email ---
r.post('/torneig/:id/inscriu', juga, (req, res) => {
  const t = getTorneig(req.params.id);
  const me = req.session.user.id;
  if (!t || !inscripcioOberta(t)) return torna(res, req.params.id, null, 'Les inscripcions estan tancades.');
  const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ? AND tournament_id = ?')
    .get(req.body.categoria, t.id);
  if (!cat) return torna(res, t.id, null, 'Categoria no vàlida.');
  if (inscripcioDe(t.id, me)) return torna(res, t.id, null, 'Ja tens una inscripció en aquest torneig.');
  const email = String(req.body.company_email || '').trim().toLowerCase();
  if (!email.includes('@')) return torna(res, t.id, null, 'Escriu l\u2019email de la teva parella.');
  const company = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);
  if (!company) return torna(res, t.id, null, 'Aquest email no és d\u2019un usuari de PadelVallès. La teva parella s\u2019hi ha de registrar primer.');
  if (!company.email_verified) return torna(res, t.id, null, 'La teva parella encara no ha verificat el compte.');
  if (company.id === me) return torna(res, t.id, null, 'No et pots convidar a tu mateix.');
  if (inscripcioDe(t.id, company.id)) return torna(res, t.id, null, 'Aquest jugador ja està inscrit en aquest torneig.');
  db.prepare(`INSERT INTO registrations (tournament_id, category_id, player1_id, player2_id, status)
    VALUES (?, ?, ?, ?, 'pending')`).run(t.id, cat.id, me, company.id);
  db.prepare(`UPDATE partner_search SET status = 'closed' WHERE tournament_id = ? AND user_id = ? AND status = 'open'`)
    .run(t.id, me);
  const jo = db.prepare('SELECT name FROM users WHERE id = ?').get(me);
  sendInvitacioParella(company.email, company.name, jo.name, t.name, etiqueta(cat));
  return torna(res, t.id, 'invitacio-enviada');
});

// --- Acceptar la invitació (jugador 2) ---
r.post('/torneig/:id/invitacio/:rid/accepta', juga, (req, res) => {
  const t = getTorneig(req.params.id);
  const me = req.session.user.id;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?')
    .get(req.params.rid, req.params.id);
  if (!insc || insc.player2_id !== me || insc.status !== 'pending') {
    return torna(res, req.params.id, null, 'Invitació no vàlida.');
  }
  if (!t || !inscripcioOberta(t)) {
    db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
    return torna(res, req.params.id, null, 'Les inscripcions ja estan tancades.');
  }
  const altra1 = inscripcioDe(t.id, insc.player1_id);
  const altra2 = inscripcioDe(t.id, insc.player2_id);
  if ((altra1 && altra1.id !== insc.id) || (altra2 && altra2.id !== insc.id)) {
    db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
    return torna(res, t.id, null, 'Algun membre de la parella ja està inscrit amb una altra persona.');
  }
  const lliures = placesCategoria(insc.category_id);
  const nouEstat = (lliures === null || lliures > 0) ? 'registered' : 'waitlist';
  db.prepare(`UPDATE registrations SET status = ?, decided_at = datetime('now') WHERE id = ?`).run(nouEstat, insc.id);
  db.prepare(`UPDATE partner_search SET status = 'closed' WHERE tournament_id = ? AND status = 'open' AND user_id IN (?, ?)`)
    .run(t.id, insc.player1_id, insc.player2_id);
  const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ?').get(insc.category_id);
  const { p1, p2 } = parellaDe(insc);
  const enEspera = nouEstat === 'waitlist';
  sendInvitacioAcceptada(p1.email, p1.name, p2.name, t.name, etiqueta(cat));
  sendInscripcioConfirmada(p1.email, p1.name, t.name, etiqueta(cat), enEspera);
  sendInscripcioConfirmada(p2.email, p2.name, t.name, etiqueta(cat), enEspera);
  return torna(res, t.id, enEspera ? 'en-espera' : 'invitacio-acceptada');
});

// --- Rebutjar la invitació (jugador 2) ---
r.post('/torneig/:id/invitacio/:rid/rebutja', juga, (req, res) => {
  const me = req.session.user.id;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?')
    .get(req.params.rid, req.params.id);
  if (!insc || insc.player2_id !== me || insc.status !== 'pending') {
    return torna(res, req.params.id, null, 'Invitació no vàlida.');
  }
  db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
  const t = getTorneig(req.params.id);
  const { p1, p2 } = parellaDe(insc);
  if (t) sendInvitacioRebutjada(p1.email, p1.name, p2.name, t.name);
  return torna(res, req.params.id, 'invitacio-rebutjada');
});

// --- Cancel·lar la invitació enviada (jugador 1) ---
r.post('/torneig/:id/invitacio/:rid/cancella', juga, (req, res) => {
  const me = req.session.user.id;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?')
    .get(req.params.rid, req.params.id);
  if (!insc || insc.player1_id !== me || insc.status !== 'pending') {
    return torna(res, req.params.id, null, 'Invitació no vàlida.');
  }
  db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
  return torna(res, req.params.id, 'invitacio-cancelada');
});

// --- Donar-se de baixa (qualsevol dels dos, dins el termini del club) ---
r.post('/torneig/:id/baixa/:rid', juga, (req, res) => {
  const t = getTorneig(req.params.id);
  const me = req.session.user.id;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?')
    .get(req.params.rid, req.params.id);
  if (!insc || (insc.player1_id !== me && insc.player2_id !== me) ||
      !['registered', 'waitlist'].includes(insc.status)) {
    return torna(res, req.params.id, null, 'Inscripció no vàlida.');
  }
  if (!t || !potDesapuntar(t)) {
    return torna(res, req.params.id, null, 'El termini per donar-se de baixa ha passat. Contacta directament amb el club.');
  }
  db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
  const promoguda = promouLlistaEspera(t.id, insc.category_id);
  if (promoguda) {
    const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ?').get(promoguda.category_id);
    const { p1, p2 } = parellaDe(promoguda);
    sendPromocioEspera(p1.email, p1.name, t.name, etiqueta(cat));
    sendPromocioEspera(p2.email, p2.name, t.name, etiqueta(cat));
  }
  return torna(res, req.params.id, 'baixa-feta');
});

// --- Busco parella: publicar l'anunci ---
r.post('/torneig/:id/busco-parella', juga, (req, res) => {
  const t = getTorneig(req.params.id);
  const me = req.session.user.id;
  if (!t || !inscripcioOberta(t)) return torna(res, req.params.id, null, 'Les inscripcions estan tancades.');
  if (inscripcioDe(t.id, me)) return torna(res, t.id, null, 'Ja tens una inscripció en aquest torneig.');
  const modalitat = String(req.body.modalitat || '');
  if (!MODALITATS[modalitat]) return torna(res, t.id, null, 'Modalitat no vàlida.');
  const nivell = String(req.body.nivell || '').trim().slice(0, 60);
  const nota = String(req.body.nota || '').trim().slice(0, 140);
  const ja = db.prepare(`SELECT 1 FROM partner_search WHERE tournament_id = ? AND user_id = ? AND status = 'open'`)
    .get(t.id, me);
  if (ja) return torna(res, t.id, null, 'Ja tens un anunci publicat per a aquest torneig.');
  db.prepare(`INSERT INTO partner_search (tournament_id, user_id, modality, level, note, status)
    VALUES (?, ?, ?, ?, ?, 'open')`).run(t.id, me, modalitat, nivell, nota);
  return torna(res, t.id, 'anunci-publicat');
});

// --- Busco parella: treure l'anunci ---
r.post('/torneig/:id/busco-parella/treu', juga, (req, res) => {
  db.prepare(`UPDATE partner_search SET status = 'closed'
    WHERE tournament_id = ? AND user_id = ? AND status = 'open'`).run(req.params.id, req.session.user.id);
  return torna(res, req.params.id, 'anunci-tret');
});

// --- Busco parella: proposar fer parella a un cercador ---
r.post('/torneig/:id/busco-parella/:psid/proposa', juga, (req, res) => {
  const t = getTorneig(req.params.id);
  const me = req.session.user.id;
  if (!t || !inscripcioOberta(t)) return torna(res, req.params.id, null, 'Les inscripcions estan tancades.');
  const cercador = db.prepare(`SELECT ps.*, u.name AS nom, u.email AS email, u.email_verified
    FROM partner_search ps JOIN users u ON u.id = ps.user_id
    WHERE ps.id = ? AND ps.tournament_id = ? AND ps.status = 'open'`).get(req.params.psid, req.params.id);
  if (!cercador) return torna(res, req.params.id, null, 'Aquest anunci ja no està disponible.');
  if (cercador.user_id === me) return torna(res, t.id, null, 'És el teu propi anunci.');
  if (!cercador.email_verified) return torna(res, t.id, null, 'Aquest jugador encara no ha verificat el compte.');
  if (inscripcioDe(t.id, me)) return torna(res, t.id, null, 'Ja tens una inscripció en aquest torneig.');
  if (inscripcioDe(t.id, cercador.user_id)) {
    db.prepare(`UPDATE partner_search SET status = 'closed' WHERE id = ?`).run(cercador.id);
    return torna(res, t.id, null, 'Aquest jugador ja està inscrit en aquest torneig.');
  }
  const cat = db.prepare(`SELECT * FROM tournament_categories
    WHERE tournament_id = ? AND modality = ? AND level = ?`).get(t.id, cercador.modality, cercador.level);
  if (!cat) return torna(res, t.id, null, 'La categoria d\u2019aquest anunci ja no existeix en el torneig.');
  db.prepare(`INSERT INTO registrations (tournament_id, category_id, player1_id, player2_id, status)
    VALUES (?, ?, ?, ?, 'pending')`).run(t.id, cat.id, me, cercador.user_id);
  db.prepare(`UPDATE partner_search SET status = 'closed' WHERE tournament_id = ? AND user_id = ? AND status = 'open'`)
    .run(t.id, me);
  const jo = db.prepare('SELECT name FROM users WHERE id = ?').get(me);
  sendInvitacioParella(cercador.email, cercador.nom, jo.name, t.name, etiqueta(cat));
  return torna(res, t.id, 'proposta-enviada');
});

export default r;
