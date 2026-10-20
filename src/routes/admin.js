import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import db from '../db.js';
import { requireRole } from '../middleware.js';
import { sorteigDiari, sorteigFinal } from '../lib/advent.js';
import { COMARQUES } from '../brand.js';
import { dirPujades } from './club.js';
import { sendClaimResolta, sendOrganitzadorResolt } from '../mail.js';

const r = Router();
r.use(requireRole('admin'));

const pujada = multer({
  dest: dirPujades(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Format no vàlid'), ok);
  }
});

function log(actorId, action, type, id, note = '') {
  db.prepare(`INSERT INTO moderation_log (actor_id, action, target_type, target_id, note)
              VALUES (?, ?, ?, ?, ?)`).run(actorId, action, type, id, note);
}

// Quadre de comandament: cues de moderació
r.get('/', (req, res) => {
  const clubsPendents = db.prepare(`
    SELECT c.*, u.name AS qui, u.email AS qui_email
    FROM clubs c LEFT JOIN club_users cu ON cu.club_id = c.id
    LEFT JOIN users u ON u.id = cu.user_id
    WHERE c.verified = 0 ORDER BY c.created_at`).all();
  const tornejosPendents = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble, u.name AS qui, o.name AS org_nom
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN organizers o ON o.id = t.organizer_id
    WHERE t.status = 'pending' ORDER BY t.created_at`).all();
  const avisos = db.prepare(`
    SELECT r.*, t.name AS torneig_nom FROM reports r
    JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.status = 'open' ORDER BY r.created_at DESC`).all();
  const stats = {
    clubs: db.prepare(`SELECT COUNT(*) n FROM clubs WHERE verified = 1`).get().n,
    tornejos: db.prepare(`SELECT COUNT(*) n FROM tournaments WHERE status = 'published'`).get().n,
    usuaris: db.prepare(`SELECT COUNT(*) n FROM users`).get().n
  };
  const organitzadorsPendents = db.prepare(`
    SELECT o.*, u.name AS qui, u.email AS qui_email
    FROM organizers o JOIN users u ON u.id = o.user_id
    WHERE o.status = 'pending' ORDER BY o.created_at`).all();
  let sollicitudsServei = [];
  try {
    sollicitudsServei = db.prepare(`
      SELECT s.*, c.name AS club_nom, u.name AS qui, u.email AS qui_email, t.name AS torneig_nom
      FROM servei_sollicituds s
      JOIN clubs c ON c.id = s.club_id
      JOIN users u ON u.id = s.user_id
      LEFT JOIN tournaments t ON t.id = s.tournament_id
      WHERE s.status = 'pending' ORDER BY s.created_at DESC`).all();
  } catch { /* taula encara no creada */ }
  const notesPendents = db.prepare(`
    SELECT n.*, c.name AS club_nom_llista
    FROM club_notes n LEFT JOIN clubs c ON c.id = n.club_id
    WHERE n.status = 'pendent' ORDER BY n.created_at`).all();
  res.render('admin/index', { titol: 'Administració', clubsPendents, tornejosPendents, avisos, stats, organitzadorsPendents, sollicitudsServei, notesPendents });
});

// Bústia de novetats: aprovar / rebutjar nota
r.post('/notes/:id/aprova', (req, res) => {
  db.prepare(`UPDATE club_notes SET status = 'aprovada', resolta_at = datetime('now')
              WHERE id = ? AND status = 'pendent'`).run(req.params.id);
  log(req.session.user.id, 'nota_aprovada', 'club_notes', req.params.id);
  res.redirect('/admin');
});

r.post('/notes/:id/rebutja', (req, res) => {
  db.prepare(`UPDATE club_notes SET status = 'rebutjada', resolta_at = datetime('now')
              WHERE id = ? AND status = 'pendent'`).run(req.params.id);
  log(req.session.user.id, 'nota_rebutjada', 'club_notes', req.params.id);
  res.redirect('/admin');
});

// Marcar una sol·licitud de servei com a gestionada
r.post('/serveis/:id/gestionada', (req, res) => {
  db.prepare(`UPDATE servei_sollicituds SET status = 'gestionada', gestionada_at = datetime('now')
              WHERE id = ? AND status = 'pending'`).run(req.params.id);
  log(req.session.user.id, 'servei_gestionat', 'servei_sollicitud', req.params.id);
  res.redirect('/admin');
});

// Aprovar / rebutjar club
r.post('/clubs/:id/aprova', (req, res) => {
  db.prepare('UPDATE clubs SET verified = 1 WHERE id = ?').run(req.params.id);
  log(req.session.user.id, 'club_aprovat', 'club', req.params.id);
  res.redirect('/admin');
});

r.post('/clubs/:id/rebutja', (req, res) => {
  const motiu = String(req.body.motiu || 'Sense motiu indicat').slice(0, 300);
  db.prepare('DELETE FROM club_users WHERE club_id = ?').run(req.params.id);
  db.prepare('DELETE FROM clubs WHERE id = ?').run(req.params.id);
  log(req.session.user.id, 'club_rebutjat', 'club', req.params.id, motiu);
  res.redirect('/admin');
});

// Amagar un club verificat (p. ex. ha tancat): desapareix del web públic.
// Reversible: amb "Aprova" torna a ser visible amb tot el seu contingut.
r.post('/clubs/:id/amaga', (req, res) => {
  db.prepare('UPDATE clubs SET verified = 0 WHERE id = ?').run(req.params.id);
  log(req.session.user.id, 'club_amagat', 'club', req.params.id);
  res.redirect('/admin/clubs?' + new URLSearchParams({ estat: req.query.estat || 'tots', q: req.query.q || '' }).toString());
});

// Aprovar / rebutjar torneig
r.post('/tornejos/:id/aprova', (req, res) => {
  db.prepare(`UPDATE tournaments SET status = 'published', published_at = datetime('now'), reject_reason = '' WHERE id = ?`)
    .run(req.params.id);
  log(req.session.user.id, 'torneig_aprovat', 'tournament', req.params.id);
  res.redirect('/admin');
});

r.post('/tornejos/:id/rebutja', (req, res) => {
  const motiu = String(req.body.motiu || 'No compleix els criteris de publicació.').slice(0, 500);
  db.prepare(`UPDATE tournaments SET status = 'rejected', reject_reason = ? WHERE id = ?`).run(motiu, req.params.id);
  log(req.session.user.id, 'torneig_rebutjat', 'tournament', req.params.id, motiu);
  res.redirect('/admin');
});

// Despublicar un torneig publicat (p. ex. promoció encoberta)
r.post('/tornejos/:id/despublica', (req, res) => {
  const motiu = String(req.body.motiu || 'Despublicat per l’administrador.').slice(0, 500);
  db.prepare(`UPDATE tournaments SET status = 'rejected', reject_reason = ? WHERE id = ?`).run(motiu, req.params.id);
  log(req.session.user.id, 'torneig_despublicat', 'tournament', req.params.id, motiu);
  res.redirect('/admin/tornejos');
});

// Tornar a publicar un torneig rebutjat o despublicat
r.post('/tornejos/:id/publica', (req, res) => {
  db.prepare(`UPDATE tournaments SET status = 'published', published_at = datetime('now'), reject_reason = '' WHERE id = ?`)
    .run(req.params.id);
  log(req.session.user.id, 'torneig_republicat', 'tournament', req.params.id);
  res.redirect('/admin/tornejos');
});

// Aprovar / rebutjar un perfil d'organitzador
r.post('/organitzadors/:id/aprova', (req, res) => {
  const org = db.prepare(`SELECT * FROM organizers WHERE id = ? AND status = 'pending'`).get(req.params.id);
  if (!org) return res.redirect('/admin');
  db.prepare(`UPDATE organizers SET status = 'approved', decided_at = datetime('now') WHERE id = ?`).run(org.id);
  const usuari = db.prepare('SELECT name, email FROM users WHERE id = ?').get(org.user_id);
  log(req.session.user.id, 'organitzador_aprovat', 'organizer', org.id, usuari.email);
  sendOrganitzadorResolt(usuari.email, usuari.name, org.name, true);
  res.redirect('/admin');
});

r.post('/organitzadors/:id/rebutja', (req, res) => {
  const org = db.prepare(`SELECT * FROM organizers WHERE id = ? AND status = 'pending'`).get(req.params.id);
  if (!org) return res.redirect('/admin');
  const motiu = String(req.body.motiu || 'No compleix els criteris.').slice(0, 500);
  db.prepare(`UPDATE organizers SET status = 'rejected', reject_reason = ?, decided_at = datetime('now') WHERE id = ?`)
    .run(motiu, org.id);
  const usuari = db.prepare('SELECT name, email FROM users WHERE id = ?').get(org.user_id);
  log(req.session.user.id, 'organitzador_rebutjat', 'organizer', org.id, usuari.email);
  sendOrganitzadorResolt(usuari.email, usuari.name, org.name, false, motiu);
  res.redirect('/admin');
});

// Tancar un avís
r.post('/avisos/:id/tanca', (req, res) => {
  db.prepare(`UPDATE reports SET status = 'closed' WHERE id = ?`).run(req.params.id);
  res.redirect('/admin');
});

// Serveis per club: l'admin atorga crèdits (nº de torneos) o quota anual per servei
import { autoritzacionsDe, resumDrets } from '../lib/autoritzacions.js';

r.get('/clubs/:id/serveis', (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).render('404', { titol: 'No trobat' });
  const autoritzacions = autoritzacionsDe(club.id);
  const tornejosPagament = db.prepare(`
    SELECT id, name, servei, starts_at, status FROM tournaments
    WHERE club_id = ? AND servei IN ('inscripcions','torneig')
    ORDER BY starts_at DESC LIMIT 50`).all(club.id);
  const sollicitud = db.prepare(`SELECT * FROM servei_sollicituds
    WHERE club_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`).get(club.id);
  res.render('admin/club-serveis', {
    titol: `Serveis: ${club.name}`, club, autoritzacions, tornejosPagament,
    resum: resumDrets(club.id), sollicitud: sollicitud || null, error: null, ok: req.query.ok || null,
  });
});

r.post('/clubs/:id/serveis', (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.params.id);
  if (!club) return res.status(404).render('404', { titol: 'No trobat' });
  const servei = req.body.servei === 'torneig' ? 'torneig' : 'inscripcions';
  const modalitat = req.body.modalitat === 'anual' ? 'anual' : 'credits';
  const quantitat = Math.max(1, Math.min(1000, parseInt(req.body.quantitat, 10) || 0));
  let validFins = String(req.body.valid_fins || '').slice(0, 10);
  if (modalitat === 'anual' && !/^\d{4}-\d{2}-\d{2}$/.test(validFins)) {
    const d = new Date(); d.setFullYear(d.getFullYear() + 1);
    validFins = d.toISOString().slice(0, 10);
  }
  if (modalitat === 'credits' && !quantitat) {
    return res.redirect(`/admin/clubs/${club.id}/serveis`);
  }
  const notes = String(req.body.notes || '').trim().slice(0, 300);
  db.prepare(`INSERT INTO club_serveis (club_id, servei, modalitat, quantitat, valid_fins, notes)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(club.id, servei, modalitat, modalitat === 'credits' ? quantitat : 0,
         modalitat === 'anual' ? validFins : '', notes);
  log(req.session.user.id, 'servei_atorgat', 'club', club.id, `${servei} ${modalitat}`);
  res.redirect(`/admin/clubs/${club.id}/serveis?ok=1`);
});

r.post('/clubs/:id/serveis/:sid/toggle', (req, res) => {
  db.prepare(`UPDATE club_serveis SET actiu = 1 - actiu WHERE id = ? AND club_id = ?`)
    .run(req.params.sid, req.params.id);
  log(req.session.user.id, 'servei_toggle', 'club', req.params.id, `autorització ${req.params.sid}`);
  res.redirect(`/admin/clubs/${req.params.id}/serveis`);
});

// Llistats
r.get('/tornejos', (req, res) => {
  const tornejos = db.prepare(`
    SELECT t.*, c.name AS club_nom FROM tournaments t JOIN clubs c ON c.id = t.club_id
    ORDER BY t.starts_at DESC LIMIT 200`).all();
  res.render('admin/tornejos', { titol: 'Tornejos', tornejos });
});

r.get('/clubs', (req, res) => {
  const estat = ['pendents', 'verificats', 'tots'].includes(req.query.estat) ? req.query.estat : 'tots';
  const q = String(req.query.q || '').trim();
  const conds = [], params = [];
  if (estat === 'pendents') conds.push('c.verified = 0');
  if (estat === 'verificats') conds.push('c.verified = 1');
  if (q) { conds.push('(c.name LIKE ? OR c.town LIKE ? OR c.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const clubs = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM tournaments t WHERE t.club_id = c.id) AS n_tornejos,
      (SELECT GROUP_CONCAT(u.id || '|' || u.name || ' <' || u.email || '>', ';;')
         FROM club_users cu JOIN users u ON u.id = cu.user_id WHERE cu.club_id = c.id) AS gestors
    FROM clubs c ${where} ORDER BY c.verified, c.name`).all(...params);
  const total = db.prepare('SELECT COUNT(*) n FROM clubs').get().n;
  const nPendents = db.prepare('SELECT COUNT(*) n FROM clubs WHERE verified = 0').get().n;
  const claims = db.prepare(`
    SELECT cc.*, u.name AS usuari_nom, u.email AS usuari_email, c.name AS club_nom, c.verified AS club_verificat
    FROM club_claims cc
    JOIN users u ON u.id = cc.user_id
    JOIN clubs c ON c.id = cc.club_id
    WHERE cc.status = 'pending'
    ORDER BY cc.created_at ASC`).all();
  const resumsServeis = {};
  for (const c of clubs) resumsServeis[c.id] = resumDrets(c.id);
  res.render('admin/clubs', { titol: 'Clubs', clubs, estat, q, total, nPendents, claims, resumsServeis,
    reclamat: req.query.reclamat || null, creat: req.query.creat || null,
    appUrl: (process.env.APP_URL || 'https://padelvalles.com').replace(/\/$/, '') });
});

// Formulari de nou club (l'admin el crea ja verificat)
r.get('/clubs/nou', (req, res) => {
  res.render('admin/club-nou', { titol: 'Nou club', COMARQUES, error: null, valors: {} });
});

r.post('/clubs/nou', pujada.single('logo'), (req, res) => {
  const v = {
    name: String(req.body.nom || '').trim(),
    town: String(req.body.municipi || '').trim(),
    comarca: COMARQUES[req.body.comarca] ? req.body.comarca : '',
    address: String(req.body.adreca || '').trim(),
    website: String(req.body.web || '').trim(),
    phone: String(req.body.telefon || '').trim(),
    email: String(req.body.email || '').trim(),
    courts: String(req.body.pistes || '').trim(),
    description: String(req.body.descripcio || '').trim(),
  };
  if (!v.name || !v.town || !v.comarca) {
    return res.render('admin/club-nou', { titol: 'Nou club', COMARQUES, error: 'Nom, municipi i comarca són obligatoris.', valors: v });
  }
  const logoPath = req.file ? 'uploads/' + req.file.filename : null;
  const info = db.prepare(`INSERT INTO clubs (name, town, comarca, address, website, phone, email, courts, description, logo_path, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(v.name, v.town, v.comarca, v.address, v.website, v.phone,
    v.email, v.courts === '' ? null : Number(v.courts), v.description, logoPath);
  log(req.session.user.id, 'club_creat', 'club', info.lastInsertRowid, v.name);
  res.redirect('/admin/clubs?creat=' + info.lastInsertRowid);
});

// Treure un gestor d'un club
r.post('/clubs/:id/gestor/:uid/treu', (req, res) => {
  db.prepare('DELETE FROM club_users WHERE club_id = ? AND user_id = ?').run(req.params.id, req.params.uid);
  log(req.session.user.id, 'club_gestor_tret', 'club', req.params.id, 'uid=' + req.params.uid);
  res.redirect('/admin/clubs?' + new URLSearchParams({ estat: req.query.estat || 'tots', q: req.query.q || '' }).toString());
});
// Generar enllaç de reclamació per a un club (per enviar al contacte del club)
r.post('/clubs/:id/enllac', (req, res) => {
  const token = crypto.randomBytes(20).toString('hex');
  db.prepare('UPDATE clubs SET claim_token = ? WHERE id = ?').run(token, req.params.id);
  log(req.session.user.id, 'club_enllac_reclamacio', 'club', req.params.id);
  res.redirect('/admin/clubs?reclamat=' + req.params.id);
});

// Aprovar una sol·licitud de gestió de club: l'usuari passa a ser gestor
r.post('/clubs/claims/:id/aprova', (req, res) => {
  const claim = db.prepare(`SELECT * FROM club_claims WHERE id = ? AND status = 'pending'`).get(req.params.id);
  if (!claim) return res.redirect('/admin/clubs');
  db.prepare('INSERT OR IGNORE INTO club_users (user_id, club_id) VALUES (?, ?)').run(claim.user_id, claim.club_id);
  db.prepare('UPDATE clubs SET claimed = 1 WHERE id = ?').run(claim.club_id);
  db.prepare(`UPDATE users SET role = 'club' WHERE id = ? AND role = 'player'`).run(claim.user_id);
  db.prepare(`UPDATE club_claims SET status = 'approved', decided_at = datetime('now') WHERE id = ?`).run(claim.id);
  const club = db.prepare('SELECT name FROM clubs WHERE id = ?').get(claim.club_id);
  const usuari = db.prepare('SELECT name, email FROM users WHERE id = ?').get(claim.user_id);
  log(req.session.user.id, 'club_claim_aprovat', 'club', claim.club_id, usuari.email);
  sendClaimResolta(usuari.email, usuari.name, club.name, true);
  res.redirect('/admin/clubs');
});

// Rebutjar una sol·licitud de gestió de club
r.post('/clubs/claims/:id/rebutja', (req, res) => {
  const claim = db.prepare(`SELECT * FROM club_claims WHERE id = ? AND status = 'pending'`).get(req.params.id);
  if (!claim) return res.redirect('/admin/clubs');
  db.prepare(`UPDATE club_claims SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`).run(claim.id);
  const club = db.prepare('SELECT name FROM clubs WHERE id = ?').get(claim.club_id);
  const usuari = db.prepare('SELECT name, email FROM users WHERE id = ?').get(claim.user_id);
  log(req.session.user.id, 'club_claim_rebutjat', 'club', claim.club_id, usuari.email);
  sendClaimResolta(usuari.email, usuari.name, club.name, false);
  res.redirect('/admin/clubs');
});

r.get('/usuaris', (req, res) => {
  const filtre = req.query.f === 'no-verificats' ? 'WHERE email_verified = 0' : '';
  const usuaris = db.prepare(`SELECT id, name, email, role, email_verified, created_at FROM users ${filtre} ORDER BY created_at DESC LIMIT 200`).all();
  const totalNoVerificats = db.prepare('SELECT COUNT(*) n FROM users WHERE email_verified = 0').get().n;
  res.render('admin/usuaris', { titol: 'Usuaris', usuaris, filtre: req.query.f === 'no-verificats' ? 'no-verificats' : 'tots', totalNoVerificats, esborrat: req.query.esborrat || null });
});

// Esborrar un compte NO verificat (neteja d'emails erronis o spam; la FK fa cascada)
r.post('/usuaris/:id/elimina', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u || u.email_verified || u.role === 'admin' || u.id === req.session.user.id) {
    return res.redirect('/admin/usuaris?f=no-verificats');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.redirect('/admin/usuaris?f=no-verificats&esborrat=1');
});

// Canviar rol jugador <-> monitor (l'admin assigna el rol; el club autoritza després)
r.post('/usuaris/:id/rol', (req, res) => {
  const rol = req.body.rol === 'monitor' ? 'monitor' : 'player';
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (u && (u.role === 'player' || u.role === 'monitor')) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(rol, req.params.id);
    log(req.session.user.id, 'canvi_rol', 'user', req.params.id, `${u.role} -> ${rol}`);
  }
  res.redirect('/admin/usuaris');
});

r.get('/historial', (req, res) => {
  const accions = db.prepare(`
    SELECT m.*, u.name AS qui FROM moderation_log m LEFT JOIN users u ON u.id = m.actor_id
    ORDER BY m.created_at DESC LIMIT 200`).all();
  res.render('admin/historial', { titol: 'Historial de moderació', accions });
});

// --- Calendari d'Advent: contingut dels 24 dies, estadístiques i sorteigs ---
r.get('/advent', (req, res) => {
  const dies = db.prepare('SELECT * FROM advent_days ORDER BY day').all()
    .map(d => { try { d.opcions = JSON.parse(d.quiz_options || '[]'); } catch { d.opcions = []; } return d; });
  const obertsPerDia = {};
  for (const x of db.prepare('SELECT day, COUNT(*) n FROM advent_opens GROUP BY day').all()) obertsPerDia[x.day] = x.n;
  const stats = {
    apertures: db.prepare('SELECT COUNT(*) n FROM advent_opens').get().n,
    participants: db.prepare('SELECT COUNT(DISTINCT user_id) n FROM advent_opens').get().n,
    participacions: db.prepare('SELECT COALESCE(SUM(points), 0) n FROM advent_entries').get().n,
    referits: db.prepare(`SELECT COUNT(*) n FROM advent_entries WHERE source = 'referral'`).get().n,
  };
  const topReferidors = db.prepare(`
    SELECT u.name, COUNT(*) n FROM advent_entries e JOIN users u ON u.id = e.user_id
    WHERE e.source = 'referral' GROUP BY e.user_id ORDER BY n DESC LIMIT 10`).all();
  const ranking = db.prepare(`
    SELECT u.name, SUM(e.points) pts FROM advent_entries e JOIN users u ON u.id = e.user_id
    GROUP BY e.user_id ORDER BY pts DESC LIMIT 10`).all();
  const draws = db.prepare(`
    SELECT d.*, u.name AS guanyador, u.email AS guanyador_email
    FROM advent_draws d LEFT JOIN users u ON u.id = d.winner_user_id
    ORDER BY d.created_at DESC`).all();
  res.render('admin/advent', {
    titol: "Calendari d'Advent", dies, obertsPerDia, stats, topReferidors, ranking, draws,
    fet: req.query.fet || null, error: req.query.error || null,
  });
});

r.post('/advent/dia/:day', (req, res) => {
  const day = parseInt(req.params.day, 10);
  if (!Number.isInteger(day) || day < 1 || day > 24) return res.redirect('/admin/advent');
  const type = req.body.type === 'quiz' ? 'quiz' : 'premi';
  const opcions = String(req.body.quiz_options || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6);
  let correct = parseInt(req.body.quiz_correct, 10);
  if (Number.isNaN(correct) || correct < 0 || correct >= Math.max(opcions.length, 1)) correct = 0;
  db.prepare(`UPDATE advent_days SET title = ?, description = ?, sponsor_name = ?, sponsor_url = ?,
              type = ?, quiz_question = ?, quiz_options = ?, quiz_correct = ?, is_final = ?
              WHERE day = ?`)
    .run(String(req.body.title || '').trim().slice(0, 120),
         String(req.body.description || '').trim().slice(0, 1000),
         String(req.body.sponsor_name || '').trim().slice(0, 120),
         String(req.body.sponsor_url || '').trim().slice(0, 300),
         type,
         String(req.body.quiz_question || '').trim().slice(0, 300),
         JSON.stringify(opcions), correct,
         req.body.is_final === 'on' ? 1 : 0, day);
  log(req.session.user.id, 'advent_dia_editat', 'advent_day', day);
  res.redirect('/admin/advent?fet=dia' + day + '#dia-' + day);
});

r.post('/advent/sorteig-diari', (req, res) => {
  const day = parseInt(req.body.day, 10);
  const resultat = sorteigDiari(day);
  if (resultat.error) return res.redirect('/admin/advent?error=' + encodeURIComponent(resultat.error));
  log(req.session.user.id, 'advent_sorteig_diari', 'advent_day', day, 'guanyador uid=' + resultat.winner);
  res.redirect('/admin/advent?fet=sorteig' + day);
});

r.post('/advent/sorteig-final', (req, res) => {
  const resultat = sorteigFinal();
  if (resultat.error) return res.redirect('/admin/advent?error=' + encodeURIComponent(resultat.error));
  log(req.session.user.id, 'advent_sorteig_final', 'advent', 24, 'guanyador uid=' + resultat.winner);
  res.redirect('/admin/advent?fet=sorteigfinal');
});

export default r;
