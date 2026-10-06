import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import db, { transaccio } from '../db.js';
import { requireLogin, requireRole, requireVerified } from '../middleware.js';
import { MODALITATS, TIPUS_TORNEIG } from '../brand.js';
import { comptaAmbInscripcio, promouLlistaEspera, potInscriure, placesCategoria } from '../lib/inscripcions.js';
import { competicionsDe, FORMATS, ESTATS_COMPETICIO } from '../lib/competicions.js';
import { rutesCompeticio } from './competicions.js';
import { sendPromocioEspera, sendParellaAfegidaClub, sendMonitorAutoritzat, sendTorneigValidatClub } from '../mail.js';

const r = Router();
const nomesClub = [requireLogin, requireRole('club', 'admin', 'monitor'), requireVerified];
// Gestió plena del club (crear/editar/duplicar tornejos, perfil): monitors exclosos
const nomesGestor = [requireLogin, requireRole('club', 'admin'), requireVerified];

// Carpeta de pujades: respecta DATA_DIR (proves amb còpia de la BD)
export function dirPujades() {
  const base = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const dir = path.join(base, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const pujada = multer({
  dest: dirPujades(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Format no vàlid'), ok);
  }
});

function clubsDe(userId, role) {
  if (role === 'monitor') {
    return db.prepare(`
      SELECT c.* FROM club_monitors cm JOIN clubs c ON c.id = cm.club_id
      WHERE cm.user_id = ? ORDER BY c.name`).all(userId);
  }
  return db.prepare(`
    SELECT c.* FROM club_users cu JOIN clubs c ON c.id = cu.club_id
    WHERE cu.user_id = ?`).all(userId);
}

function potGestionar(userId, clubId, esAdmin) {
  if (esAdmin) return true;
  return !!db.prepare('SELECT 1 FROM club_users WHERE user_id = ? AND club_id = ?').get(userId, clubId);
}

// El monitor autoritzat pel club pot veure inscrits i fer altes/baixes (no gestionar el club)
function esMonitorDe(userId, clubId) {
  return !!db.prepare('SELECT 1 FROM club_monitors WHERE user_id = ? AND club_id = ?').get(userId, clubId);
}

function potVeureInscrits(userId, clubId, esAdmin) {
  if (esAdmin || potGestionar(userId, clubId, false)) return true;
  return esMonitorDe(userId, clubId);
}

// Sol·licitar compte de club (qualsevol usuari registrat).
// La sol·licitud queda PENDENT: és l'admin qui l'aprova i llavors l'usuari
// passa a ser gestor del club. Així ningú pot autoassignar-se un club.
r.get('/club/sollicita', requireLogin, (req, res) => {
  const clubs = db.prepare('SELECT id, name, town FROM clubs ORDER BY name').all();
  const meves = db.prepare(`
    SELECT cc.*, c.name AS club_nom FROM club_claims cc
    JOIN clubs c ON c.id = cc.club_id
    WHERE cc.user_id = ? ORDER BY cc.created_at DESC`).all(req.session.user.id);
  res.render('club-sollicita', { titol: 'Sol·licita compte de club', clubs, error: null, ok: req.query.ok, meves });
});

r.post('/club/sollicita', requireLogin, (req, res) => {
  const clubId = Number(req.body.club_id);
  const nouNom = String(req.body.nou_nom || '').trim();
  const nouPoble = String(req.body.nou_poble || '').trim();
  const comarca = String(req.body.comarca || 'occidental');
  const contacte = String(req.body.contacte || '').trim().slice(0, 300);
  const clubs = db.prepare('SELECT id, name, town FROM clubs ORDER BY name').all();
  const meves = db.prepare(`
    SELECT cc.*, c.name AS club_nom FROM club_claims cc
    JOIN clubs c ON c.id = cc.club_id
    WHERE cc.user_id = ? ORDER BY cc.created_at DESC`).all(req.session.user.id);
  const mostra = (error) => res.render('club-sollicita',
    { titol: 'Sol·licita compte de club', clubs, error, ok: null, meves });

  if (!clubId && !(nouNom && nouPoble)) {
    return mostra('Tria el teu club o indica el nom i el municipi si no hi és.');
  }

  let id = clubId;
  if (!id) {
    const info = db.prepare(`INSERT INTO clubs (name, town, comarca, verified, claimed) VALUES (?, ?, ?, 0, 0)`)
      .run(nouNom.slice(0, 120), nouPoble.slice(0, 80), comarca === 'oriental' ? 'oriental' : 'occidental');
    id = info.lastInsertRowid;
  } else {
    const club = db.prepare('SELECT id FROM clubs WHERE id = ?').get(id);
    if (!club) return mostra('Club no vàlid.');
  }
  if (db.prepare('SELECT 1 FROM club_users WHERE user_id = ? AND club_id = ?').get(req.session.user.id, id)) {
    return mostra('Ja ets gestor d\u2019aquest club.');
  }
  if (db.prepare(`SELECT 1 FROM club_claims WHERE user_id = ? AND club_id = ? AND status = 'pending'`)
    .get(req.session.user.id, id)) {
    return mostra('Ja tens una sol·licitud pendent per a aquest club.');
  }
  db.prepare(`INSERT INTO club_claims (user_id, club_id, note) VALUES (?, ?, ?)`)
    .run(req.session.user.id, id, contacte);
  db.prepare(`INSERT INTO moderation_log (actor_id, action, target_type, target_id, note)
              VALUES (?, 'club_sollicitat', 'club', ?, ?)`).run(req.session.user.id, id, contacte);
  res.redirect('/club/sollicita?ok=1');
});

// Panell del club
r.get('/club/panel', nomesClub, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const esMonitor = req.session.user.role === 'monitor';
  const clubs = esAdmin
    ? db.prepare('SELECT * FROM clubs ORDER BY name').all()
    : clubsDe(req.session.user.id, req.session.user.role);
  const ids = clubs.map(c => c.id);
  const tornejos = ids.length ? db.prepare(`
    SELECT t.*, c.name AS club_nom FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.club_id IN (${ids.map(() => '?').join(',')})
    ORDER BY t.starts_at DESC`).all(...ids) : [];
  // Tornejos d'organitzadors pendents que el club validi (només gestors, no monitors)
  const pendentsOrg = (!esMonitor && ids.length) ? db.prepare(`
    SELECT t.*, o.name AS org_nom FROM tournaments t
    JOIN organizers o ON o.id = t.organizer_id
    WHERE t.club_id IN (${ids.map(() => '?').join(',')}) AND t.status = 'pending_club'
    ORDER BY t.created_at ASC`).all(...ids) : [];
  res.render('club-panel', { titol: 'Panell del club', clubs, tornejos, esMonitor, pendentsOrg,
    validat: req.query.validat || null, rebutjat: req.query.rebutjat || null });
});

// Formulari de torneig
// Files del formulari de categories: d'una edició (BD), d'un rebot amb error (body) o per defecte
function filesCategories(t, body) {
  if (body && (body.cat_modalitat || body.modalitat)) {
    const mods = [].concat(body.cat_modalitat || []);
    const nivs = [].concat(body.cat_nivell || []);
    const pls = [].concat(body.cat_places || []);
    const files = mods.map((m, i) => ({ modality: m, level: nivs[i] || '', max_pairs: pls[i] || '' }));
    if (files.length) return files;
  }
  if (t && t.categories && t.categories.length) {
    return t.categories.map(c => ({ modality: c.modality, level: c.level || '', max_pairs: c.max_pairs ?? '' }));
  }
  return [
    { modality: 'M', level: '', max_pairs: '' },
    { modality: 'F', level: '', max_pairs: '' },
    { modality: 'X', level: '', max_pairs: '' },
  ];
}

r.get('/club/torneig/nou', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id, req.session.user.role);
  const pendents = db.prepare(`SELECT COUNT(*) AS n FROM tournaments WHERE created_by = ? AND status = 'pending'`)
    .get(req.session.user.id).n;
  const quotes = {};
  for (const c of clubs) quotes[c.id] = comptaAmbInscripcio(c.id);
  res.render('club-torneig-form', {
    titol: 'Nou torneig', t: null, clubs, MODALITATS, TIPUS_TORNEIG, quotes, teInscrits: 0,
    filesCategories: filesCategories(null, null), potCartell: false, cartellMissatge: null, cartellErrorMsg: null,
    error: pendents >= 3 ? 'Tens 3 tornejos pendents de revisió. Espera que els aprovem abans de crear-ne més.' : null
  });
});

function desaTorneig(req, id) {
  const esAdmin = req.session.user.role === 'admin';
  const { club_id, nom, inici, fi, preu = '', via = '', url = '', descripcio = '', mode_inscripcio = 'externa',
    data_limit = '', hores_baixa = '48', tipus = 'open', mostra_inscrits = '' } = req.body;
  const clubId = Number(club_id);
  if (!potGestionar(req.session.user.id, clubId, esAdmin)) throw new Error('No pots gestionar aquest club.');
  // Categories dinàmiques: tantes files com calgui (p. ex. Masculí 1a cat, Masculí 2a cat...)
  const catMods = [].concat(req.body.cat_modalitat || []).filter(m => MODALITATS[m]);
  const catNivells = [].concat(req.body.cat_nivell || []);
  const catPlaces = [].concat(req.body.cat_places || []);
  const registration_mode = mode_inscripcio === 'padelvalles' ? 'padelvalles' : 'externa';
  const deadline = String(data_limit).slice(0, 10);
  const unregisterHores = Math.max(0, Math.min(720, parseInt(hores_baixa, 10) || 0));
  const tipusT = TIPUS_TORNEIG[tipus] ? tipus : 'open';
  const maxPairs = i => {
    const v = String(catPlaces[i] || '').trim();
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
    tipus: tipusT,
    mostra_inscrits: mostra_inscrits ? 1 : 0,
    description: String(descripcio).trim().slice(0, 2000)
  };
  if (!dades.name || !dades.starts_at) throw new Error('Falten el nom o la data del torneig.');
  if (!id && !catMods.length) throw new Error('Afegeix com a mínim una categoria al torneig.');

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
    if (nInscrits === 0 && !catMods.length) throw new Error('Afegeix com a mínim una categoria al torneig.');
    db.prepare(`UPDATE tournaments SET club_id=?, name=?, starts_at=?, ends_at=?, price_text=?,
      registration_info=?, registration_url=?, registration_mode=?, registration_deadline=?,
      unregister_hours=?, tipus=?, mostra_inscrits=?, description=?, status=?, reject_reason='' WHERE id=?`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.registration_mode, dades.registration_deadline,
        dades.unregister_hours, dades.tipus, dades.mostra_inscrits, dades.description, nouEstat, id);
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
      (club_id, name, starts_at, ends_at, price_text, registration_info, registration_url, registration_mode,
       registration_deadline, unregister_hours, tipus, mostra_inscrits, description, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.registration_mode,
        dades.registration_deadline, dades.unregister_hours, dades.tipus, dades.mostra_inscrits, dades.description, req.session.user.id);
    tid = info.lastInsertRowid;
  }
  if (recreaCategories) {
    const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, ?)');
    catMods.forEach((m, i) => ins.run(tid, m, String(catNivells[i] || '').trim().slice(0, 60), maxPairs(i)));
  }
  return tid;
}

r.post('/club/torneig/nou', nomesGestor, (req, res) => {
  try {
    desaTorneig(req, null);
    res.redirect('/club/panel?enviat=1');
  } catch (e) {
    const esAdmin = req.session.user.role === 'admin';
    const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id, req.session.user.role);
    const quotes = {};
    for (const c of clubs) quotes[c.id] = comptaAmbInscripcio(c.id);
    res.render('club-torneig-form', { titol: 'Nou torneig', t: req.body, clubs, MODALITATS, TIPUS_TORNEIG,
      quotes, teInscrits: 0, filesCategories: filesCategories(null, req.body), error: e.message,
      potCartell: false, cartellMissatge: null, cartellErrorMsg: null });
  }
});

r.get('/club/torneig/:id/edita', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) return res.status(404).render('404', { titol: 'No trobat' });
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  const clubs = esAdmin ? db.prepare('SELECT * FROM clubs ORDER BY name').all() : clubsDe(req.session.user.id, req.session.user.role);
  const quotes = {};
  for (const c of clubs) quotes[c.id] = comptaAmbInscripcio(c.id, t.id);
  const teInscrits = db.prepare(`SELECT COUNT(*) n FROM registrations
    WHERE tournament_id = ? AND status IN ('pending','registered','waitlist')`).get(t.id).n;
  const club = db.prepare('SELECT claimed FROM clubs WHERE id = ?').get(t.club_id);
  const potCartell = esAdmin || !!club?.claimed;
  let cartellMissatge = null, cartellErrorMsg = null;
  if (req.query.cartell === 'ok') cartellMissatge = 'Cartell pujat correctament.';
  if (req.query.cartell === 'esborrat') cartellMissatge = 'Cartell esborrat.';
  if (req.query.cartell_error) cartellErrorMsg = String(req.query.cartell_error);
  res.render('club-torneig-form', { titol: 'Edita el torneig', t, clubs, MODALITATS, TIPUS_TORNEIG,
    quotes, teInscrits, filesCategories: filesCategories(t, null), error: null,
    potCartell, cartellMissatge, cartellErrorMsg });
});

r.post('/club/torneig/:id/edita', nomesGestor, (req, res) => {
  try {
    desaTorneig(req, Number(req.params.id));
    res.redirect('/club/panel?enviat=1');
  } catch (e) {
    return res.status(400).send(esc(e.message));
  }
});

// --- Validació de tornejos d'organitzadors pel club seu ---
// El club valida DINS la plataforma que ha concedit permís a l'organitzador:
// el torneig passa a la cua de revisió de l'admin ('pending').
function agafaTorneigPendentOrg(req, res) {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare(`SELECT * FROM tournaments WHERE id = ? AND status = 'pending_club'`).get(req.params.id);
  if (!t || !t.organizer_id || !potGestionar(req.session.user.id, t.club_id, esAdmin)) {
    res.status(404).render('404', { titol: 'No trobat' });
    return null;
  }
  return t;
}

function avisaOrganitzadorValidacio(t, validat, motiu = '') {
  try {
    const org = db.prepare(`
      SELECT o.name AS org_nom, u.name AS nom, u.email AS email
      FROM organizers o JOIN users u ON u.id = o.user_id WHERE o.id = ?`).get(t.organizer_id);
    const club = db.prepare('SELECT name FROM clubs WHERE id = ?').get(t.club_id);
    if (org?.email) sendTorneigValidatClub(org.email, org.nom, t.name, club?.name || '', validat, motiu);
  } catch (e) { console.error('[club] avís organitzador:', e.message); }
}

r.post('/club/torneig/:id/valida', nomesGestor, (req, res) => {
  const t = agafaTorneigPendentOrg(req, res);
  if (!t) return;
  db.prepare(`UPDATE tournaments SET status = 'pending', reject_reason = '' WHERE id = ?`).run(t.id);
  db.prepare(`INSERT INTO moderation_log (actor_id, action, target_type, target_id, note)
              VALUES (?, 'torneig_validat_club', 'tournament', ?, ?)`)
    .run(req.session.user.id, t.id, 'club_id=' + t.club_id);
  avisaOrganitzadorValidacio(t, true);
  res.redirect('/club/panel?validat=1');
});

r.post('/club/torneig/:id/rebutja', nomesGestor, (req, res) => {
  const t = agafaTorneigPendentOrg(req, res);
  if (!t) return;
  const motiu = String(req.body.motiu || 'El club no ha validat aquest torneig.').slice(0, 500);
  db.prepare(`UPDATE tournaments SET status = 'rejected', reject_reason = ? WHERE id = ?`).run(motiu, t.id);
  db.prepare(`INSERT INTO moderation_log (actor_id, action, target_type, target_id, note)
              VALUES (?, 'torneig_rebutjat_club', 'tournament', ?, ?)`)
    .run(req.session.user.id, t.id, motiu);
  avisaOrganitzadorValidacio(t, false, motiu);
  res.redirect('/club/panel?rebutjat=1');
});

// --- Cartell original del club (un per torneig, al costat del cartell oficial SVG) ---
// Només clubs reclamats (o l'admin). El fitxer anterior s'esborra en substituir-lo.
function tipusImatge(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function esborraFitxerPujat(rel) {
  const base = path.basename(String(rel || ''));
  if (!base || base === '.' || base.includes('..')) return;
  try { fs.unlinkSync(path.join(dirPujades(), base)); } catch {}
}

function cartellError(res, id, codi) {
  return res.redirect(`/club/torneig/${id}/edita?cartell_error=${codi}`);
}

r.post('/club/torneig/:id/cartell', nomesGestor, (req, res) => {
  pujada.single('cartell')(req, res, (err) => {
    const id = Number(req.params.id);
    try {
      if (err) throw new Error(err.code === 'LIMIT_FILE_SIZE'
        ? 'El fitxer supera els 2 MB.'
        : 'El fitxer ha de ser una imatge PNG, JPG o WebP.');
      const esAdmin = req.session.user.role === 'admin';
      const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
      if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) throw new Error('Torneig no trobat.');
      const club = db.prepare('SELECT claimed FROM clubs WHERE id = ?').get(t.club_id);
      if (!esAdmin && !club?.claimed) throw new Error('Només els clubs reclamats poden pujar el cartell.');
      if (!req.file) throw new Error('Tria un fitxer d\'imatge.');
      const ext = tipusImatge(fs.readFileSync(req.file.path));
      if (!ext) { esborraFitxerPujat(req.file.filename); throw new Error('El fitxer no és una imatge vàlida.'); }
      const nouNom = req.file.filename + ext;
      fs.renameSync(req.file.path, path.join(process.cwd(), 'data', 'uploads', nouNom));
      esborraFitxerPujat(t.poster_path);
      db.prepare('UPDATE tournaments SET poster_path = ? WHERE id = ?').run('uploads/' + nouNom, id);
      res.redirect(`/club/torneig/${id}/edita?cartell=ok`);
    } catch (e) {
      if (req.file) esborraFitxerPujat(req.file.filename);
      cartellError(res, req.params.id, encodeURIComponent(e.message));
    }
  });
});

r.post('/club/torneig/:id/cartell/esborra', nomesGestor, (req, res) => {
  const id = Number(req.params.id);
  try {
    const esAdmin = req.session.user.role === 'admin';
    const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) throw new Error('Torneig no trobat.');
    const club = db.prepare('SELECT claimed FROM clubs WHERE id = ?').get(t.club_id);
    if (!esAdmin && !club?.claimed) throw new Error('Només els clubs reclamats poden gestionar el cartell.');
    esborraFitxerPujat(t.poster_path);
    db.prepare('UPDATE tournaments SET poster_path = ? WHERE id = ?').run('', id);
    res.redirect(`/club/torneig/${id}/edita?cartell=esborrat`);
  } catch (e) {
    cartellError(res, req.params.id, encodeURIComponent(e.message));
  }
});

// --- Inscrits d'un torneig (fase 2) ---
function inscritsDe(torneigId) {
  const cats = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(torneigId);
  for (const c of cats) {
    const etiqueta = (MODALITATS[c.modality] || c.modality) + (c.level ? ' · ' + c.level : '');
    for (const estat of ['registered', 'waitlist', 'pending']) {
      c[estat] = db.prepare(`
        SELECT r.*,
          COALESCE(u1.name, r.player1_name, '') AS nom1, u1.email AS email1, u1.phone AS tel1,
          COALESCE(u2.name, r.player2_name, '') AS nom2, u2.email AS email2, u2.phone AS tel2
        FROM registrations r
        LEFT JOIN users u1 ON u1.id = r.player1_id
        LEFT JOIN users u2 ON u2.id = r.player2_id
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

// Accés a inscrits: gestors + monitors autoritzats pel club
function agafaTorneigInscrits(req, res) {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t || !potVeureInscrits(req.session.user.id, t.club_id, esAdmin)) {
    res.status(404).render('404', { titol: 'No trobat' });
    return null;
  }
  return t;
}

r.get('/club/torneig/:id/inscrits', nomesClub, (req, res) => {
  const t = agafaTorneigInscrits(req, res);
  if (!t) return;
  const esAdmin = req.session.user.role === 'admin';
  const esGestor = potGestionar(req.session.user.id, t.club_id, esAdmin);
  const { perCat: competicionsPerCat } = competicionsDe(t.id);
  res.render('club-inscrits', { titol: 'Inscrits: ' + t.name, t, categories: inscritsDe(t.id), MODALITATS,
    alta: req.query.alta || null, errorMsg: req.query.error || null,
    competicionsPerCat, FORMATS, ESTATS_COMPETICIO, esGestor });
});

// --- Competicions (Fase 1): crear i gestionar des de les inscripcions ---
function agafaTorneigComp(req, res) {
  const esAdmin = req.session.user.role === 'admin';
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.tid);
  if (!t || !potGestionar(req.session.user.id, t.club_id, esAdmin)) {
    res.status(404).render('404', { titol: 'No trobat' });
    return null;
  }
  return t;
}
r.use(rutesCompeticio({
  base: '/club',
  middlewares: nomesClub,
  agafaTorneig: agafaTorneigComp,
  esGestor: (req, t) => potGestionar(req.session.user.id, t.club_id, req.session.user.role === 'admin'),
  getOrganitzador: null,
}));

// Duplicar un torneig (mateixes dades i categories, sense dates ni inscrits)
r.post('/club/torneig/:id/duplica', nomesGestor, (req, res) => {
  const t = agafaTorneigClub(req, res);
  if (!t) return;
  const nou = transaccio(() => {
    const r = db.prepare(`INSERT INTO tournaments
      (club_id, name, description, tipus, starts_at, ends_at, price_text, registration_info, registration_url,
       registration_mode, registration_deadline, unregister_hours, mostra_inscrits, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending', ?, datetime('now'))`).run(
      t.club_id, (t.name || 'Torneig') + ' (còpia)', t.description || '', t.tipus || 'open',
      t.starts_at, t.ends_at, t.price_text || '', t.registration_info || '', t.registration_url || '',
      t.registration_mode || 'externa', t.unregister_hours ?? 48, t.mostra_inscrits ?? 1, req.session.user.id);
    const nouId = r.lastInsertRowid;
    const cats = db.prepare('SELECT modality, level, max_pairs FROM tournament_categories WHERE tournament_id = ?').all(t.id);
    const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, ?)');
    for (const c of cats) ins.run(nouId, c.modality, c.level, c.max_pairs);
    return nouId;
  });
  res.redirect(`/club/torneig/${nou}/edita?duplicat=1`);
});

// Alta manual d'una parella pel club (les que arriben per telèfon, WhatsApp o recepció)
r.post('/club/torneig/:id/inscrits/nova', nomesClub, (req, res) => {
  const t = agafaTorneigInscrits(req, res);
  if (!t) return;
  const enrere = `/club/torneig/${t.id}/inscrits`;
  try {
    if ((t.registration_mode || 'externa') !== 'padelvalles') {
      throw new Error('Aquest torneig no té la inscripció a PadelVallès.');
    }
    const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ? AND tournament_id = ?')
      .get(req.body.categoria, t.id);
    if (!cat) throw new Error('Categoria no vàlida.');
    const nom1 = String(req.body.nom1 || '').trim().slice(0, 80);
    const nom2 = String(req.body.nom2 || '').trim().slice(0, 80);
    const email1 = String(req.body.email1 || '').trim().toLowerCase();
    const email2 = String(req.body.email2 || '').trim().toLowerCase();
    if (!nom1 || !nom2) throw new Error('Cal el nom dels dos jugadors.');
    // Si l'email és d'un usuari registrat i verificat, la parella hi queda vinculada
    const resol = (email, nom) => {
      if (!email) return { id: null, nom, email: null };
      const u = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);
      if (!u) throw new Error(`L'email ${email} no és d'un usuari registrat. Deixa l'email en blanc per apuntar la parella només amb el nom.`);
      if (!u.email_verified) throw new Error(`L'usuari ${email} encara no ha verificat el compte.`);
      return { id: u.id, nom: u.name, email: u.email };
    };
    const j1 = resol(email1, nom1);
    const j2 = resol(email2, nom2);
    if (j1.id && j1.id === j2.id) throw new Error('Els dos jugadors no poden ser la mateixa persona.');
    for (const j of [j1, j2]) {
      if (!j.id) continue;
      const motiu = potInscriure(t.id, j.id, cat.id);
      if (motiu) throw new Error(`${j.nom} ${motiu.charAt(0).toLowerCase()}${motiu.slice(1)}`);
    }
    const lliures = placesCategoria(cat.id);
    const nouEstat = (lliures === null || lliures > 0) ? 'registered' : 'waitlist';
    db.prepare(`INSERT INTO registrations
      (tournament_id, category_id, player1_id, player2_id, player1_name, player2_name, added_by_club, status, paid, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))`)
      .run(t.id, cat.id, j1.id, j2.id, j1.nom, j2.nom, nouEstat, req.body.pagat ? 1 : 0);
    const et = (MODALITATS[cat.modality] || cat.modality) + (cat.level ? ' · ' + cat.level : '');
    const enEspera = nouEstat === 'waitlist';
    if (j1.email) sendParellaAfegidaClub(j1.email, j1.nom, t.name, et, enEspera);
    if (j2.email) sendParellaAfegidaClub(j2.email, j2.nom, t.name, et, enEspera);
    res.redirect(enrere + '?alta=1');
  } catch (e) {
    res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
  }
});

r.post('/club/torneig/:id/inscrits/:rid/pagat', nomesClub, (req, res) => {
  const t = agafaTorneigInscrits(req, res);
  if (!t) return;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?').get(req.params.rid, t.id);
  if (!insc) return res.status(404).render('404', { titol: 'No trobat' });
  db.prepare('UPDATE registrations SET paid = ? WHERE id = ?').run(insc.paid ? 0 : 1, insc.id);
  res.redirect(`/club/torneig/${t.id}/inscrits`);
});

r.post('/club/torneig/:id/inscrits/:rid/treu', nomesClub, (req, res) => {
  const t = agafaTorneigInscrits(req, res);
  if (!t) return;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?').get(req.params.rid, t.id);
  if (!insc) return res.status(404).render('404', { titol: 'No trobat' });
  let promoguda = null;
  transaccio(() => {
    db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
    promoguda = promouLlistaEspera(t.id, insc.category_id);
  });
  if (promoguda) {
    const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ?').get(promoguda.category_id);
    const et = (MODALITATS[cat.modality] || cat.modality) + (cat.level ? ' · ' + cat.level : '');
    for (const uid of [promoguda.player1_id, promoguda.player2_id]) {
      if (!uid) continue;
      const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(uid);
      if (u) sendPromocioEspera(u.email, u.name, t.name, et);
    }
  }
  res.redirect(`/club/torneig/${t.id}/inscrits`);
});

r.get('/club/torneig/:id/inscrits.csv', nomesClub, (req, res) => {
  const t = agafaTorneigInscrits(req, res);
  if (!t) return;
  const files = ['categoria;estat;parella;jugador1;email1;telefon1;jugador2;email2;telefon2;pagat'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const c of inscritsDe(t.id)) {
    for (const estat of ['registered', 'waitlist', 'pending']) {
      for (const insc of c[estat]) {
        files.push([q(c.etiqueta), q(estat), q(`${insc.nom1} / ${insc.nom2}`),
          q(insc.nom1), q(insc.email1), q(insc.tel1), q(insc.nom2), q(insc.email2), q(insc.tel2),
          q(insc.paid ? 'sí' : 'no')].join(';'));
      }
    }
  }
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="inscrits-${t.id}.csv"`);
  res.send('﻿' + files.join('\n'));
});

function esc(s) { return String(s).replace(/</g, '&lt;'); }

// Monitors autoritzats pel club (veure inscrits + altes/baixes)
// Només el gestor del club pot autoritzar-los.
r.get('/club/:clubId/monitors', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.clubId);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) {
    return res.status(404).render('404', { titol: 'No trobat' });
  }
  const monitors = db.prepare(`
    SELECT u.id, u.name, u.email, cm.created_at FROM club_monitors cm
    JOIN users u ON u.id = cm.user_id WHERE cm.club_id = ? ORDER BY u.name`).all(club.id);
  res.render('club-monitors', { titol: 'Monitors', club, monitors, error: req.query.error || null, ok: req.query.ok || null, email: req.query.email || '' });
});

r.post('/club/:clubId/monitors', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.clubId);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) {
    return res.status(404).render('404', { titol: 'No trobat' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const tornaError = (msg) => res.redirect(
    `/club/${club.id}/monitors?error=${encodeURIComponent(msg)}&email=${encodeURIComponent(email)}`);
  if (!u) {
    return tornaError('Aquest email no és de cap usuari de PadelVallès. La persona s\u2019ha de registrar primer (gratis) i després la podràs autoritzar.');
  }
  if (!u.email_verified) {
    return tornaError('Aquest compte encara no ha verificat l\u2019email. Demana a la persona que el verifiqui i torna-ho a provar.');
  }
  if (u.role === 'admin') {
    return tornaError('No cal autoritzar un administrador.');
  }
  if (esMonitorDe(u.id, club.id)) {
    return tornaError('Aquesta persona ja és monitor autoritzat d\u2019aquest club.');
  }
  // Pas 1: mostrar qui és abans d'autoritzar (evita errors d'email)
  res.render('club-monitors-confirma', { titol: 'Confirma el monitor', club, usuari: u });
});

// Pas 2: confirmació de l'autorització (amb avís per email al monitor)
r.post('/club/:clubId/monitors/confirma', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.clubId);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) {
    return res.status(404).render('404', { titol: 'No trobat' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !u.email_verified || u.role === 'admin') {
    return res.redirect(`/club/${club.id}/monitors?error=${encodeURIComponent('No s\u2019ha pogut autoritzar: comprova l\u2019email.')}`);
  }
  if (esMonitorDe(u.id, club.id)) {
    return res.redirect(`/club/${club.id}/monitors?ok=1`);
  }
  if (u.role === 'player') db.prepare(`UPDATE users SET role = 'monitor' WHERE id = ?`).run(u.id);
  db.prepare('INSERT OR IGNORE INTO club_monitors (club_id, user_id) VALUES (?, ?)').run(club.id, u.id);
  sendMonitorAutoritzat(u.email, u.name, club.name);
  res.redirect(`/club/${club.id}/monitors?ok=1`);
});

r.post('/club/:clubId/monitors/:uid/treu', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.clubId);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) {
    return res.status(404).render('404', { titol: 'No trobat' });
  }
  db.prepare('DELETE FROM club_monitors WHERE club_id = ? AND user_id = ?').run(club.id, req.params.uid);
  res.redirect(`/club/${club.id}/monitors?ok=1`);
});

// Fitxa del club (dades + logo)
r.get('/club/perfil/:id', nomesGestor, (req, res) => {
  const esAdmin = req.session.user.role === 'admin';
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club || !potGestionar(req.session.user.id, club.id, esAdmin)) return res.status(404).render('404', { titol: 'No trobat' });
  res.render('club-perfil', { titol: 'Fitxa del club', club, error: null, ok: req.query.ok });
});

r.post('/club/perfil/:id', nomesGestor, pujada.single('logo'), (req, res) => {
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
  // L'enllaç és d'un sol ús: s'invalida en reclamar el club
  db.prepare('UPDATE clubs SET claimed = 1, claim_token = NULL WHERE id = ?').run(club.id);
  res.redirect('/club/panel?reclamat=1');
});

export default r;

// Helpers reutilitzats pel mòdul d'organitzadors
export { inscritsDe, potGestionar, esMonitorDe, potVeureInscrits, clubsDe, filesCategories };
export { pujada, tipusImatge, esborraFitxerPujat };
