import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import db from '../db.js';
import { requireLogin, requireRole, requireVerified } from '../middleware.js';
import { MODALITATS } from '../brand.js';
import { comptaAmbInscripcio, promouLlistaEspera } from '../lib/inscripcions.js';
import { sendPromocioEspera } from '../mail.js';

const r = Router();
const nomesClub = [requireLogin, requireRole('club', 'admin'), requireVerified];

const pujada = multer({
  dest: path.join(process.cwd(), 'data', 'uploads'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Format no vàlid'), ok);
  }
});

function clubsDe(userId) {
  return db.prepare(`
    SELECT c.* FROM club_users cu JOIN clubs c ON c.id = cu.club_id
    WHERE cu.user_id = ?`).all(userId);
}

function potGestionar(userId, clubId, esAdmin) {
  if (esAdmin) return true;
  return !!db.prepare('SELECT 1 FROM club_users WHERE user_id = ? AND club_id = ?').get(userId, clubId);
}

// Sol·licitar compte de club (qualsevol usuari registrat)
r.get('/club/sollicita', requireLogin, (req, res) => {
  const clubs = db.prepare('SELECT id, name, town FROM clubs ORDER BY name').all();
  res.render('club-sollicita', { titol: 'Sol·licita compte de club', clubs, error: null, ok: req.query.ok });
});

r.post('/club/sollicita', requireLogin, (req, res) => {
  const clubId = Number(req.body.club_id);
  const nouNom = String(req.body.nou_nom || '').trim();
  const nouPoble = String(req.body.nou_poble || '').trim();
  const comarca = String(req.body.comarca || 'occidental');
  const contacte = String(req.body.contacte || '').trim().slice(0, 300);

  if (!clubId && !(nouNom && nouPoble)) {
    const clubs = db.prepare('SELECT id, name, town FROM clubs ORDER BY name').all();
    return res.render('club-sollicita', { titol: 'Sol·licita compte de club', clubs, error: 'Tria el teu club o indica el nom i el municipi si no hi és.', ok: null });
  }

  let id = clubId;
  if (!id) {
    const info = db.prepare(`INSERT INTO clubs (name, town, comarca, verified, claimed) VALUES (?, ?, ?, 0, 1)`)
      .run(nouNom.slice(0, 120), nouPoble.slice(0, 80), comarca === 'oriental' ? 'oriental' : 'occidental');
    id = info.lastInsertRowid;
  } else {
    db.prepare('UPDATE clubs SET claimed = 1 WHERE id = ?').run(id);
  }
  db.prepare('INSERT OR IGNORE INTO club_users (user_id, club_id) VALUES (?, ?)').run(req.session.user.id, id);
  db.prepare(`INSERT INTO moderation_log (actor_id, action, target_type, target_id, note)
              VALUES (?, 'club_sollicitat', 'club', ?, ?)`).run(req.session.user.id, id, contacte);
  // L'usuari passa a rol club, però el club queda pendent de verificació
  db.prepare(`UPDATE users SET role = 'club' WHERE id = ? AND role = 'player'`).run(req.session.user.id);
  req.session.user.role = 'club';
  res.redirect('/club/sollicita?ok=1');
});

// Panell del club
r.get('/club/panel', nomesClub, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const clubs = esAdmin
    ? db.prepare('SELECT * FROM clubs ORDER BY name').all()
    : clubsDe(req.session.user.id);
  const ids = clubs.map(c => c.id);
  const tornejos = ids.length ? db.prepare(`
    SELECT t.*, c.name AS club_nom FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.club_id IN (${ids.map(() => '?').join(',')})
    ORDER BY t.starts_at DESC`).all(...ids) : [];
  res.render('club-panel', { titol: 'Panell del club', clubs, tornejos });
});

// Formulari de torneig
r.get('/club/torneig/nou', nomesClub, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id);
  const pendents = db.prepare(`SELECT COUNT(*) AS n FROM tournaments WHERE created_by = ? AND status = 'pending'`)
    .get(req.session.user.id).n;
  const quotes = {};
  for (const c of clubs) quotes[c.id] = comptaAmbInscripcio(c.id);
  res.render('club-torneig-form', {
    titol: 'Nou torneig', t: null, clubs, MODALITATS, quotes, teInscrits: 0,
    error: pendents >= 3 ? 'Tens 3 tornejos pendents de revisió. Espera que els aprovem abans de crear-ne més.' : null
  });
});

function desaTorneig(req, id) {
  const esAdmin = req.session.user.role === 'admin';
  const { club_id, nom, inici, fi, preu = '', via = '', url = '', descripcio = '', mode_inscripcio = 'externa',
    data_limit = '', hores_baixa = '48' } = req.body;
  const clubId = Number(club_id);
  if (!potGestionar(req.session.user.id, clubId, esAdmin)) throw new Error('No pots gestionar aquest club.');
  const modalitats = [].concat(req.body.modalitat || []).filter(m => MODALITATS[m]);
  const nivells = [].concat(req.body.nivell || []);
  const places = [].concat(req.body.places || []);
  const registration_mode = mode_inscripcio === 'padelvalles' ? 'padelvalles' : 'externa';
  const deadline = String(data_limit).slice(0, 10);
  const unregisterHores = Math.max(0, Math.min(720, parseInt(hores_baixa, 10) || 0));
  const maxPairs = i => {
    const v = String(places[i] || '').trim();
    if (v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : null;
  };

  const dades = {
    club_id: clubId,
    name: String(nom || '').trim().slice(0, 140),
    starts_at: String(inici || '').slice(0, 10),
    ends_at: String(fi || String(inici || '')).slice(0, 10),
    price_text: String(preu).trim().slice(0, 80),
    registration_info: String(via).trim().slice(0, 300),
    registration_url: String(url).trim().slice(0, 300),
    registration_mode,
    registration_deadline: deadline,
    unregister_hours: unregisterHores,
    description: String(descripcio).trim().slice(0, 2000)
  };
  if (!dades.name || !dades.starts_at) throw new Error('Falten el nom o la data del torneig.');

  let tid = id;
  let recreaCategories = true;
  if (id) {
    const actual = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    if (!actual || !potGestionar(req.session.user.id, actual.club_id, esAdmin)) throw new Error('Torneig no trobat.');
    // L'admin conserva l'estat en editar (p. ex. només canvia l'enllaç d'inscripció);
    // el club torna a moderació.
    const nouEstat = esAdmin ? actual.status : 'pending';
    const nInscrits = db.prepare(`SELECT COUNT(*) n FROM registrations
      WHERE tournament_id = ? AND status IN ('pending','registered','waitlist')`).get(id).n;
    db.prepare(`UPDATE tournaments SET club_id=?, name=?, starts_at=?, ends_at=?, price_text=?,
      registration_info=?, registration_url=?, registration_mode=?, registration_deadline=?,
      unregister_hours=?, description=?, status=?, reject_reason='' WHERE id=?`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.registration_mode, dades.registration_deadline,
        dades.unregister_hours, dades.description, nouEstat, id);
    if (nInscrits > 0) {
      // Amb inscripcions actives no es poden canviar les categories, només les places
      recreaCategories = false;
      for (const cat of db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(id)) {
        const v = String(req.body['places_' + cat.id] || '').trim();
        const nou = v === '' ? null : Math.min(500, Math.max(1, parseInt(v, 10) || 1));
        const nReg = db.prepare(`SELECT COUNT(*) n FROM registrations
          WHERE category_id = ? AND status = 'registered'`).get(cat.id).n;
        if (nou !== null && nou < nReg) throw new Error(`«${MODALITATS[cat.modality]}» ja té ${nReg} parelles inscrites: no pots baixar de ${nReg} places.`);
        db.prepare('UPDATE tournament_categories SET max_pairs = ? WHERE id = ?').run(nou, cat.id);
      }
    } else {
      db.prepare('DELETE FROM tournament_categories WHERE tournament_id = ?').run(id);
    }
  } else {
    const info = db.prepare(`INSERT INTO tournaments
      (club_id, name, starts_at, ends_at, price_text, registration_info, registration_url, registration_mode, description, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.registration_mode, dades.description, req.session.user.id);
    tid = info.lastInsertRowid;
  }
  if (recreaCategories) {
    const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, ?)');
    modalitats.forEach((m, i) => ins.run(tid, m, String(nivells[i] || '').trim().slice(0, 60), maxPairs(i)));
  }
  return tid;
}

r.post('/club/torneig/nou', nomesClub, (req, res) => {
  try {
    desaTorneig(req, null);
    res.redirect('/club/panel?enviat=1');
  } catch (e) {
    const esAdmin = req.session.user.role === 'admin';
    const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id);
    const quotes = {};
    for (const c of clubs) quotes[c.id] = comptaAmbInscripcio(c.id);
    res.render('club-torneig-form', { titol: 'Nou torneig', t: req.body, clubs, MODALITATS, quotes, teInscrits: 0, error: e.message });
  }
});

r.get('/club/torneig/:id/edita', nomesClub, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) return res.status(404).render('404', { titol: 'No trobat' });
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id);
  const quotes = {};
  for (const c of clubs) quotes[c.id] = comptaAmbInscripcio(c.id, t.id);
  const teInscrits = db.prepare(`SELECT COUNT(*) n FROM registrations
    WHERE tournament_id = ? AND status IN ('pending','registered','waitlist')`).get(t.id).n;
  res.render('club-torneig-form', { titol: 'Edita el torneig', t, clubs, MODALITATS, quotes, teInscrits, error: null });
});

r.post('/club/torneig/:id/edita', nomesClub, (req, res) => {
  try {
    desaTorneig(req, Number(req.params.id));
    res.redirect('/club/panel?enviat=1');
  } catch (e) {
    return res.status(400).send(esc(e.message));
  }
});

// --- Inscrits d'un torneig (fase 2) ---
function inscritsDe(torneigId) {
  const cats = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(torneigId);
  for (const c of cats) {
    const etiqueta = (MODALITATS[c.modality] || c.modality) + (c.level ? ' · ' + c.level : '');
    for (const estat of ['registered', 'waitlist', 'pending']) {
      c[estat] = db.prepare(`
        SELECT r.*, u1.name AS nom1, u1.email AS email1, u2.name AS nom2, u2.email AS email2
        FROM registrations r
        JOIN users u1 ON u1.id = r.player1_id JOIN users u2 ON u2.id = r.player2_id
        WHERE r.tournament_id = ? AND r.category_id = ? AND r.status = ?
        ORDER BY r.decided_at ASC, r.id ASC`).all(torneigId, c.id, estat);
    }
    c.etiqueta = etiqueta;
    c.nInscrits = c.registered.length;
  }
  return cats;
}

function agafaTorneigClub(req, res) {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) {
    res.status(404).render('404', { titol: 'No trobat' });
    return null;
  }
  return t;
}

r.get('/club/torneig/:id/inscrits', nomesClub, (req, res) => {
  const t = agafaTorneigClub(req, res);
  if (!t) return;
  res.render('club-inscrits', { titol: 'Inscrits: ' + t.name, t, categories: inscritsDe(t.id), MODALITATS });
});

r.post('/club/torneig/:id/inscrits/:rid/pagat', nomesClub, (req, res) => {
  const t = agafaTorneigClub(req, res);
  if (!t) return;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?').get(req.params.rid, t.id);
  if (!insc) return res.status(404).render('404', { titol: 'No trobat' });
  db.prepare('UPDATE registrations SET paid = ? WHERE id = ?').run(insc.paid ? 0 : 1, insc.id);
  res.redirect(`/club/torneig/${t.id}/inscrits`);
});

r.post('/club/torneig/:id/inscrits/:rid/treu', nomesClub, (req, res) => {
  const t = agafaTorneigClub(req, res);
  if (!t) return;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?').get(req.params.rid, t.id);
  if (!insc) return res.status(404).render('404', { titol: 'No trobat' });
  db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
  const promoguda = promouLlistaEspera(t.id, insc.category_id);
  if (promoguda) {
    const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ?').get(promoguda.category_id);
    const et = (MODALITATS[cat.modality] || cat.modality) + (cat.level ? ' · ' + cat.level : '');
    for (const uid of [promoguda.player1_id, promoguda.player2_id]) {
      const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(uid);
      sendPromocioEspera(u.email, u.name, t.name, et);
    }
  }
  res.redirect(`/club/torneig/${t.id}/inscrits`);
});

r.get('/club/torneig/:id/inscrits.csv', nomesClub, (req, res) => {
  const t = agafaTorneigClub(req, res);
  if (!t) return;
  const files = ['categoria;estat;parella;jugador1;email1;jugador2;email2;pagat'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const c of inscritsDe(t.id)) {
    for (const estat of ['registered', 'waitlist', 'pending']) {
      for (const insc of c[estat]) {
        files.push([q(c.etiqueta), q(estat), q(`${insc.nom1} / ${insc.nom2}`),
          q(insc.nom1), q(insc.email1), q(insc.nom2), q(insc.email2),
          q(insc.paid ? 'sí' : 'no')].join(';'));
      }
    }
  }
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="inscrits-${t.id}.csv"`);
  res.send('﻿' + files.join('\n'));
});

function esc(s) { return String(s).replace(/</g, '&lt;'); }

// Fitxa del club (dades + logo)
r.get('/club/perfil/:id', nomesClub, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) return res.status(404).render('404', { titol: 'No trobat' });
  res.render('club-perfil', { titol: 'Fitxa del club', club, error: null, ok: req.query.ok });
});

r.post('/club/perfil/:id', nomesClub, pujada.single('logo'), (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) return res.status(404).render('404', { titol: 'No trobat' });
  const { adreca = '', web = '', telefon = '', email = '', descripcio = '', pistes = '' } = req.body;
  let logoPath = club.logo_path;
  if (req.file) logoPath = 'uploads/' + req.file.filename;
  db.prepare(`UPDATE clubs SET address=?, website=?, phone=?, email=?, description=?, courts=?, logo_path=? WHERE id=?`)
    .run(adreca.trim().slice(0, 200), web.trim().slice(0, 200), telefon.trim().slice(0, 40),
      email.trim().slice(0, 120), descripcio.trim().slice(0, 1000),
      pistes ? Number(pistes) : null, logoPath, club.id);
  res.redirect(`/club/perfil/${club.id}?ok=1`);
});

// Reclamació d'un club amb enllaç d'invitació (l'admin l'envia al contacte del club)
r.get('/reclama/:token', requireLogin, requireVerified, (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE claim_token = ?').get(req.params.token);
  if (!club) return res.status(404).render('404', { titol: 'Enllaç no vàlid' });
  const jaGestor = db.prepare('SELECT 1 FROM club_users WHERE user_id = ? AND club_id = ?')
    .get(req.session.user.id, club.id);
  const gestors = db.prepare(`SELECT u.name FROM club_users cu JOIN users u ON u.id = cu.user_id WHERE cu.club_id = ?`)
    .all(club.id).map(g => g.name);
  res.render('reclama', { titol: 'Reclama el teu club', club, jaGestor: !!jaGestor, gestors,
    esAdmin: req.session.user.role === 'admin' });
});

r.post('/reclama/:token', requireLogin, requireVerified, (req, res) => {
  if (req.session.user.role === 'admin') return res.redirect('/club/panel');
  const club = db.prepare('SELECT * FROM clubs WHERE claim_token = ?').get(req.params.token);
  if (!club) return res.status(404).render('404', { titol: 'Enllaç no vàlid' });
  db.prepare('INSERT OR IGNORE INTO club_users (user_id, club_id) VALUES (?, ?)').run(req.session.user.id, club.id);
  db.prepare('UPDATE clubs SET claimed = 1 WHERE id = ?').run(club.id);
  res.redirect('/club/panel?reclamat=1');
});

export default r;
