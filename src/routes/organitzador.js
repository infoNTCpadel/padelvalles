import { Router } from 'express';
import db, { transaccio } from '../db.js';
import { requireLogin, requireVerified } from '../middleware.js';
import { MODALITATS, TIPUS_TORNEIG } from '../brand.js';
import { promouLlistaEspera, potInscriure, placesCategoria } from '../lib/inscripcions.js';
import { inscritsDe, pujada, tipusImatge, esborraFitxerPujat, filesCategories, dirPujades } from './club.js';
import { competicionsDe, FORMATS, ESTATS_COMPETICIO } from '../lib/competicions.js';
import { rutesCompeticio } from './competicions.js';
import { sendTorneigPendentValidacio } from '../mail.js';
import fs from 'node:fs';
import path from 'node:path';

const r = Router();

// Perfil d'organitzador aprovat de l'usuari (o null)
export function organitzadorDe(userId) {
  return db.prepare(`SELECT * FROM organizers WHERE user_id = ? AND status = 'approved'`).get(userId) || null;
}

// Accés a les rutes de gestió: cal tenir el perfil d'organitzador aprovat
function requireOrg(req, res, next) {
  if (!req.session.user) return res.redirect('/entra');
  const org = organitzadorDe(req.session.user.id);
  if (!org) return res.status(403).send('Accés denegat.');
  req.organitzador = org;
  next();
}
const nomesOrg = [requireLogin, requireVerified, requireOrg];

function esc(s) { return String(s).replace(/</g, '&lt;'); }

// El torneig és de l'organitzador (i existeix)
function agafaTorneigOrg(req, res) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ? AND organizer_id = ?')
    .get(req.params.id, req.organitzador.id);
  if (!t) {
    res.status(404).render('404', { titol: 'No trobat' });
    return null;
  }
  return t;
}

// --- Sol·licitud de perfil d'organitzador (qualsevol usuari registrat) ---
r.get('/organitzador/sollicita', requireLogin, requireVerified, (req, res) => {
  const meva = db.prepare('SELECT * FROM organizers WHERE user_id = ?').get(req.session.user.id) || null;
  res.render('organitzador-sollicita', { titol: "Sol·licita el perfil d'organitzador", meva, error: null, ok: req.query.ok });
});

r.post('/organitzador/sollicita', requireLogin, requireVerified, (req, res) => {
  const nom = String(req.body.nom || '').trim().slice(0, 120);
  const descripcio = String(req.body.descripcio || '').trim().slice(0, 1000);
  const web = String(req.body.web || '').trim().slice(0, 200);
  const meva = db.prepare('SELECT * FROM organizers WHERE user_id = ?').get(req.session.user.id) || null;
  const mostra = (error) => res.render('organitzador-sollicita',
    { titol: "Sol·licita el perfil d'organitzador", meva, error, ok: null });
  if (meva && meva.status === 'pending') return mostra('Ja tens una sol·licitud pendent de revisió.');
  if (meva && meva.status === 'approved') return mostra('Ja tens el perfil d\u2019organitzador aprovat.');
  if (!nom) return mostra('Indica el nom de l\u2019organitzador (p. ex. el nom del teu projecte o marca).');
  if (meva && meva.status === 'rejected') {
    db.prepare(`UPDATE organizers SET name=?, description=?, web=?, status='pending', reject_reason='', created_at=datetime('now'), decided_at=NULL WHERE id=?`)
      .run(nom, descripcio, web, meva.id);
  } else {
    db.prepare(`INSERT INTO organizers (user_id, name, description, web) VALUES (?, ?, ?, ?)`)
      .run(req.session.user.id, nom, descripcio, web);
  }
  db.prepare(`INSERT INTO moderation_log (actor_id, action, target_type, note) VALUES (?, 'organitzador_sollicitat', 'organizer', ?)`)
    .run(req.session.user.id, nom);
  res.redirect('/organitzador/sollicita?ok=1');
});

// --- Panell de l'organitzador ---
r.get('/organitzador/panel', nomesOrg, (req, res) => {
  const tornejos = db.prepare(`
    SELECT t.*, c.name AS club_nom FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.organizer_id = ? ORDER BY t.starts_at DESC`).all(req.organitzador.id);
  res.render('organitzador-panel', {
    titol: "Panell de l'organitzador", org: req.organitzador, tornejos,
    enviat: req.query.enviat || null
  });
});

// --- Perfil públic de l'organitzador (logo, descripció, web) ---
r.get('/organitzador/perfil', nomesOrg, (req, res) => {
  res.render('organitzador-perfil', { titol: "Perfil de l'organitzador", org: req.organitzador, error: null, ok: req.query.ok });
});

r.post('/organitzador/perfil', nomesOrg, pujada.single('logo'), (req, res) => {
  const { nom = '', descripcio = '', web = '' } = req.body;
  const mostra = (error) => res.render('organitzador-perfil',
    { titol: "Perfil de l'organitzador", org: req.organitzador, error, ok: null });
  const nomNet = String(nom).trim().slice(0, 120);
  if (!nomNet) return mostra('El nom és obligatori.');
  let logoPath = req.organitzador.logo_path;
  if (req.file) {
    const ext = tipusImatge(fs.readFileSync(req.file.path));
    if (!ext) { esborraFitxerPujat(req.file.filename); return mostra('El fitxer no és una imatge vàlida (PNG, JPG o WebP).'); }
    const nouNom = req.file.filename + ext;
    fs.renameSync(req.file.path, path.join(dirPujades(), nouNom));
    esborraFitxerPujat(logoPath);
    logoPath = 'uploads/' + nouNom;
  }
  db.prepare('UPDATE organizers SET name=?, description=?, web=?, logo_path=? WHERE id=?')
    .run(nomNet, String(descripcio).trim().slice(0, 1000), String(web).trim().slice(0, 200), logoPath, req.organitzador.id);
  res.redirect('/organitzador/perfil?ok=1');
});

// --- Crear / editar tornejos (sempre amb club seu, que els valida) ---
function desaTorneigOrg(req, id) {
  const org = req.organitzador;
  const { club_id, nom, inici, fi, preu = '', via = '', url = '', descripcio = '', mode_inscripcio = 'externa',
    data_limit = '', hores_baixa = '48', tipus = 'open', mostra_inscrits = '' } = req.body;
  const clubId = Number(club_id);
  const seu = db.prepare('SELECT * FROM clubs WHERE id = ? AND verified = 1').get(clubId);
  if (!seu) throw new Error('Tria un club seu vàlid del directori.');
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
    const actual = agafaTorneigOrgNum(req, id);
    if (!actual) throw new Error('Torneig no trobat.');
    const nInscrits = db.prepare(`SELECT COUNT(*) n FROM registrations
      WHERE tournament_id = ? AND status IN ('pending','registered','waitlist')`).get(id).n;
    if (nInscrits === 0 && !catMods.length) throw new Error('Afegeix com a mínim una categoria al torneig.');
    // Qualsevol edició de l'organitzador torna a validació del club seu
    db.prepare(`UPDATE tournaments SET club_id=?, name=?, starts_at=?, ends_at=?, price_text=?,
      registration_info=?, registration_url=?, registration_mode=?, registration_deadline=?,
      unregister_hours=?, tipus=?, mostra_inscrits=?, description=?, status='pending_club', reject_reason='' WHERE id=?`)
      .run(dades.club_id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.registration_mode, dades.registration_deadline,
        dades.unregister_hours, dades.tipus, dades.mostra_inscrits, dades.description, id);
    if (nInscrits > 0) {
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
    avisaClubSeu(dades.club_id, dades.name, org.name);
  } else {
    const info = db.prepare(`INSERT INTO tournaments
      (club_id, organizer_id, name, starts_at, ends_at, price_text, registration_info, registration_url, registration_mode,
       registration_deadline, unregister_hours, tipus, mostra_inscrits, description, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_club', ?)`)
      .run(dades.club_id, org.id, dades.name, dades.starts_at, dades.ends_at, dades.price_text,
        dades.registration_info, dades.registration_url, dades.registration_mode,
        dades.registration_deadline, dades.unregister_hours, dades.tipus, dades.mostra_inscrits, dades.description, req.session.user.id);
    tid = info.lastInsertRowid;
    avisaClubSeu(dades.club_id, dades.name, org.name);
  }
  if (recreaCategories) {
    const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, ?)');
    catMods.forEach((m, i) => ins.run(tid, m, String(catNivells[i] || '').trim().slice(0, 60), maxPairs(i)));
  }
  return tid;
}

function agafaTorneigOrgNum(req, id) {
  return db.prepare('SELECT * FROM tournaments WHERE id = ? AND organizer_id = ?').get(id, req.organitzador.id) || null;
}

// Avisa el club seu (si té email) que un organitzador li proposa un torneig
function avisaClubSeu(clubId, torneigNom, orgNom) {
  try {
    const club = db.prepare('SELECT name, email FROM clubs WHERE id = ?').get(clubId);
    if (!club || !club.email) return;
    const gestors = db.prepare(`
      SELECT u.name, u.email FROM club_users cu JOIN users u ON u.id = cu.user_id
      WHERE cu.club_id = ?`).all(clubId);
    const dest = gestors.length ? gestors[0] : { name: club.name, email: club.email };
    sendTorneigPendentValidacio(dest.email, dest.name, club.name, torneigNom, orgNom);
  } catch (e) { console.error('[organitzador] avís club seu:', e.message); }
}

function formOrg(req, res, t, error) {
  const seus = db.prepare('SELECT id, name, town FROM clubs WHERE verified = 1 ORDER BY name').all();
  res.render('organitzador-torneig-form', {
    titol: t && t.id ? 'Edita el torneig' : 'Nou torneig',
    t, seus, MODALITATS, TIPUS_TORNEIG,
    filesCategories: filesCategories(t, t && t.id ? null : req.body),
    teInscrits: t && t.id ? db.prepare(`SELECT COUNT(*) n FROM registrations
      WHERE tournament_id = ? AND status IN ('pending','registered','waitlist')`).get(t.id).n : 0,
    error: error || null,
    cartellMissatge: req.query.cartell === 'ok' ? 'Cartell pujat correctament.'
      : req.query.cartell === 'esborrat' ? 'Cartell esborrat.' : null,
    cartellErrorMsg: req.query.cartell_error ? String(req.query.cartell_error) : null
  });
}

r.get('/organitzador/torneig/nou', nomesOrg, (req, res) => {
  const pendents = db.prepare(`SELECT COUNT(*) AS n FROM tournaments
    WHERE organizer_id = ? AND status IN ('pending_club','pending')`).get(req.organitzador.id).n;
  if (pendents >= 3) {
    return formOrg(req, res, null, 'Tens 3 tornejos pendents de revisió. Espera que es resolguin abans de crear-ne més.');
  }
  formOrg(req, res, null, null);
});

r.post('/organitzador/torneig/nou', nomesOrg, (req, res) => {
  try {
    desaTorneigOrg(req, null);
    res.redirect('/organitzador/panel?enviat=1');
  } catch (e) {
    formOrg(req, res, { ...req.body, id: null }, e.message);
  }
});

r.get('/organitzador/torneig/:id/edita', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
  if (!t) return;
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  formOrg(req, res, t, null);
});

r.post('/organitzador/torneig/:id/edita', nomesOrg, (req, res) => {
  try {
    desaTorneigOrg(req, Number(req.params.id));
    res.redirect('/organitzador/panel?enviat=1');
  } catch (e) {
    return res.status(400).send(esc(e.message));
  }
});

// Duplicar un torneig (mateixes dades i categories, torna a validació del club)
r.post('/organitzador/torneig/:id/duplica', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
  if (!t) return;
  const nou = transaccio(() => {
    const q = db.prepare(`INSERT INTO tournaments
      (club_id, organizer_id, name, description, tipus, starts_at, ends_at, price_text, registration_info, registration_url,
       registration_mode, registration_deadline, unregister_hours, mostra_inscrits, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending_club', ?, datetime('now'))`).run(
      t.club_id, req.organitzador.id, (t.name || 'Torneig') + ' (còpia)', t.description || '', t.tipus || 'open',
      t.starts_at, t.ends_at, t.price_text || '', t.registration_info || '', t.registration_url || '',
      t.registration_mode || 'externa', t.unregister_hours ?? 48, t.mostra_inscrits ?? 1, req.session.user.id);
    const nouId = q.lastInsertRowid;
    const cats = db.prepare('SELECT modality, level, max_pairs FROM tournament_categories WHERE tournament_id = ?').all(t.id);
    const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, ?)');
    for (const c of cats) ins.run(nouId, c.modality, c.level, c.max_pairs);
    return nouId;
  });
  const club = db.prepare('SELECT name FROM clubs WHERE id = ?').get(t.club_id);
  avisaClubSeu(t.club_id, (t.name || 'Torneig') + ' (còpia)', req.organitzador.name);
  res.redirect(`/organitzador/torneig/${nou}/edita?duplicat=1`);
});

// --- Cartell de l'organitzador (un per torneig, com el dels clubs reclamats) ---
r.post('/organitzador/torneig/:id/cartell', nomesOrg, (req, res) => {
  pujada.single('cartell')(req, res, (err) => {
    const id = Number(req.params.id);
    try {
      if (err) throw new Error(err.code === 'LIMIT_FILE_SIZE'
        ? 'El fitxer supera els 2 MB.'
        : 'El fitxer ha de ser una imatge PNG, JPG o WebP.');
      const t = agafaTorneigOrgNum(req, id);
      if (!t) throw new Error('Torneig no trobat.');
      if (!req.file) throw new Error('Tria un fitxer d\u2019imatge.');
      const ext = tipusImatge(fs.readFileSync(req.file.path));
      if (!ext) { esborraFitxerPujat(req.file.filename); throw new Error('El fitxer no és una imatge vàlida.'); }
      const nouNom = req.file.filename + ext;
      fs.renameSync(req.file.path, path.join(dirPujades(), nouNom));
      esborraFitxerPujat(t.poster_path);
      db.prepare('UPDATE tournaments SET poster_path = ? WHERE id = ?').run('uploads/' + nouNom, id);
      res.redirect(`/organitzador/torneig/${id}/edita?cartell=ok`);
    } catch (e) {
      if (req.file) esborraFitxerPujat(req.file.filename);
      res.redirect(`/organitzador/torneig/${id}/edita?cartell_error=${encodeURIComponent(e.message)}`);
    }
  });
});

r.post('/organitzador/torneig/:id/cartell/esborra', nomesOrg, (req, res) => {
  const id = Number(req.params.id);
  const t = agafaTorneigOrgNum(req, id);
  if (!t) return res.status(404).render('404', { titol: 'No trobat' });
  esborraFitxerPujat(t.poster_path);
  db.prepare('UPDATE tournaments SET poster_path = ? WHERE id = ?').run('', id);
  res.redirect(`/organitzador/torneig/${id}/edita?cartell=esborrat`);
});

// --- Inscrits dels seus tornejos (mateixa gestió que els clubs) ---
r.get('/organitzador/torneig/:id/inscrits', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
  if (!t) return;
  const { perCat: competicionsPerCat } = competicionsDe(t.id);
  res.render('club-inscrits', { titol: 'Inscrits: ' + t.name, t, categories: inscritsDe(t.id), MODALITATS,
    alta: req.query.alta || null, errorMsg: req.query.error || null, creades: req.query.creades || null,
    baseRuta: '/organitzador', competicionsPerCat, FORMATS, ESTATS_COMPETICIO, esGestor: true });
});

// --- Competicions (Fase 1): crear i gestionar des de les inscripcions ---
function agafaTorneigCompOrg(req, res) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ? AND organizer_id = ?')
    .get(req.params.tid, req.organitzador.id);
  if (!t) {
    res.status(404).render('404', { titol: 'No trobat' });
    return null;
  }
  return t;
}
r.use(rutesCompeticio({
  base: '/organitzador',
  middlewares: nomesOrg,
  agafaTorneig: agafaTorneigCompOrg,
  esGestor: () => true,
  getOrganitzador: (req) => req.organitzador,
}));

r.post('/organitzador/torneig/:id/inscrits/nova', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
  if (!t) return;
  const enrere = `/organitzador/torneig/${t.id}/inscrits`;
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
    res.redirect(enrere + '?alta=1');
  } catch (e) {
    res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
  }
});

r.post('/organitzador/torneig/:id/inscrits/:rid/pagat', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
  if (!t) return;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?').get(req.params.rid, t.id);
  if (!insc) return res.status(404).render('404', { titol: 'No trobat' });
  db.prepare('UPDATE registrations SET paid = ? WHERE id = ?').run(insc.paid ? 0 : 1, insc.id);
  res.redirect(`/organitzador/torneig/${t.id}/inscrits`);
});

r.post('/organitzador/torneig/:id/inscrits/:rid/treu', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
  if (!t) return;
  const insc = db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_id = ?').get(req.params.rid, t.id);
  if (!insc) return res.status(404).render('404', { titol: 'No trobat' });
  transaccio(() => {
    db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE id = ?`).run(insc.id);
    promouLlistaEspera(t.id, insc.category_id);
  });
  res.redirect(`/organitzador/torneig/${t.id}/inscrits`);
});

r.get('/organitzador/torneig/:id/inscrits.csv', nomesOrg, (req, res) => {
  const t = agafaTorneigOrg(req, res);
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

export default r;
