import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import path from 'node:path';
import db from '../db.js';
import { requireRole } from '../middleware.js';
import { COMARQUES } from '../brand.js';

const r = Router();
r.use(requireRole('admin'));

const pujada = multer({
  dest: path.join(process.cwd(), 'data', 'uploads'),
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
    SELECT t.*, c.name AS club_nom, c.town AS club_poble, u.name AS qui
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    LEFT JOIN users u ON u.id = t.created_by
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
  res.render('admin/index', { titol: 'Administració', clubsPendents, tornejosPendents, avisos, stats });
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

// Tancar un avís
r.post('/avisos/:id/tanca', (req, res) => {
  db.prepare(`UPDATE reports SET status = 'closed' WHERE id = ?`).run(req.params.id);
  res.redirect('/admin');
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
  res.render('admin/clubs', { titol: 'Clubs', clubs, estat, q, total, nPendents,
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

r.get('/usuaris', (req, res) => {
  const usuaris = db.prepare('SELECT id, name, email, role, email_verified, created_at FROM users ORDER BY created_at DESC LIMIT 200').all();
  res.render('admin/usuaris', { titol: 'Usuaris', usuaris });
});

r.get('/historial', (req, res) => {
  const accions = db.prepare(`
    SELECT m.*, u.name AS qui FROM moderation_log m LEFT JOIN users u ON u.id = m.actor_id
    ORDER BY m.created_at DESC LIMIT 200`).all();
  res.render('admin/historial', { titol: 'Historial de moderació', accions });
});

export default r;
