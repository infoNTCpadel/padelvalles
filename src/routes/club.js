import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import db from '../db.js';
import { requireLogin, requireRole, requireVerified } from '../middleware.js';
import { MODALITATS } from '../brand.js';

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
  res.render('club-torneig-form', {
    titol: 'Nou torneig', t: null, clubs, MODALITATS,
    error: pendents >= 3 ? 'Tens 3 tornejos pendents de revisió. Espera que els aprovem abans de crear-ne més.' : null
  });
});

function desaTorneig(req, id) {
  const esAdmin = req.session.user.role === 'admin';
  const { club_id, nom, inici, fi, preu = '', via = '', url = '', descripcio = '' } = req.body;
  const clubId = Number(club_id);
  if (!potGestionar(req.session.user.id, clubId, esAdmin)) throw new Error('No pots gestionar aquest club.');
  const modalitats = [].concat(req.body.modalitat || []).filter(m => MODALITATS[m]);
  const nivells = [].concat(req.body.nivell || []);

  const dades = {
    club_id: clubId,
    name: String(nom || '').trim().slice(0, 140),
    starts_at: String(inici || '').slice(0, 10),
    ends_at: String(fi || String(inici || '')).slice(0, 10),
    price_text: String(preu).trim().slice(0, 80),
    registration_info: String(via).trim().slice(0, 300),
    registration_url: String(url).trim().slice(0, 300),
    description: String(descripcio).trim().slice(0, 2000)
  };
  if (!dades.name || !dades.starts_at) throw new Error('Falten el nom o la data del torneig.');

  let tid = id;
  if (id) {
    const actual = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    if (!actual || !potGestionar(req.session.user.id, actual.club_id, esAdmin)) throw new Error('Torneig no trobat.');
    // L'admin conserva l'estat en editar (p. ex. només canvia l'enllaç d'inscripció);
    // el club torna a moderació.
    const nouEstat = esAdmin ? actual.status : 'pending';
    db.prepare(`UPDATE tournaments SET club_id=?, name=?, starts_at=?, ends_at=?, price_text=?,
      registration_info=?, registration_url=?, description=?, status=?, reject_reason='' WHERE id=?`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.description, nouEstat, id);
    db.prepare('DELETE FROM tournament_categories WHERE tournament_id = ?').run(id);
  } else {
    const info = db.prepare(`INSERT INTO tournaments
      (club_id, name, starts_at, ends_at, price_text, registration_info, registration_url, description, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.description, req.session.user.id);
    tid = info.lastInsertRowid;
  }
  const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level) VALUES (?, ?, ?)');
  modalitats.forEach((m, i) => ins.run(tid, m, String(nivells[i] || '').trim().slice(0, 60)));
  return tid;
}

r.post('/club/torneig/nou', nomesClub, (req, res) => {
  try {
    desaTorneig(req, null);
    res.redirect('/club/panel?enviat=1');
  } catch (e) {
    const esAdmin = req.session.user.role === 'admin';
    const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id);
    res.render('club-torneig-form', { titol: 'Nou torneig', t: req.body, clubs, MODALITATS, error: e.message });
  }
});

r.get('/club/torneig/:id/edita', nomesClub, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) return res.status(404).render('404', { titol: 'No trobat' });
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id);
  res.render('club-torneig-form', { titol: 'Edita el torneig', t, clubs, MODALITATS, error: null });
});

r.post('/club/torneig/:id/edita', nomesClub, (req, res) => {
  try {
    desaTorneig(req, Number(req.params.id));
    res.redirect('/club/panel?enviat=1');
  } catch (e) {
    return res.status(400).send(esc(e.message));
  }
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

export default r;
