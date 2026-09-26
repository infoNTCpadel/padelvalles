import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireLogin } from '../middleware.js';
import { MODALITATS } from '../brand.js';

const r = Router();
const NIVELLS = ['Iniciació', 'Intermig', 'Avançat', 'Competició'];

// El meu compte (jugador)
r.get('/elmeucompte', requireLogin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const interessos = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble
    FROM interests i
    JOIN tournaments t ON t.id = i.tournament_id
    JOIN clubs c ON c.id = t.club_id
    WHERE i.user_id = ? AND t.status = 'published'
    ORDER BY t.starts_at ASC`).all(user.id);
  const clubs = db.prepare(`
    SELECT c.* FROM follows f JOIN clubs c ON c.id = f.club_id
    WHERE f.user_id = ? ORDER BY c.name`).all(user.id);
  const elsMeusClubs = user.role === 'club'
    ? db.prepare(`SELECT c.* FROM club_users cu JOIN clubs c ON c.id = cu.club_id WHERE cu.user_id = ?`).all(user.id)
    : [];
  // Fase 2: les meves inscripcions i invitacions
  const inscripcions = db.prepare(`
    SELECT r.*, t.name AS torneig_nom, t.starts_at, t.ends_at, c.name AS club_nom,
      tc.modality, tc.level,
      CASE WHEN r.player1_id = ? THEN COALESCE(u2.name, r.player2_name, '') ELSE COALESCE(u1.name, r.player1_name, '') END AS parella_nom
    FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN clubs c ON c.id = t.club_id
    JOIN tournament_categories tc ON tc.id = r.category_id
    LEFT JOIN users u1 ON u1.id = r.player1_id LEFT JOIN users u2 ON u2.id = r.player2_id
    WHERE (r.player1_id = ? OR r.player2_id = ?) AND r.status IN ('registered','waitlist')
    ORDER BY t.starts_at ASC`).all(user.id, user.id, user.id);
  const invitacionsRebudes = db.prepare(`
    SELECT r.*, t.name AS torneig_nom, tc.modality, tc.level, u.name AS qui_nom
    FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN tournament_categories tc ON tc.id = r.category_id
    JOIN users u ON u.id = r.player1_id
    WHERE r.player2_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`).all(user.id);
  const invitacionsEnviades = db.prepare(`
    SELECT r.*, t.name AS torneig_nom, tc.modality, tc.level, u.name AS qui_nom
    FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN tournament_categories tc ON tc.id = r.category_id
    JOIN users u ON u.id = r.player2_id
    WHERE r.player1_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`).all(user.id);
  const anuncis = db.prepare(`
    SELECT ps.*, t.name AS torneig_nom FROM partner_search ps
    JOIN tournaments t ON t.id = ps.tournament_id
    WHERE ps.user_id = ? AND ps.status = 'open' AND t.status = 'published'
    ORDER BY t.starts_at ASC`).all(user.id);
  res.render('compte', { titol: 'El meu compte', user, interessos, clubs, elsMeusClubs, NIVELLS,
    inscripcions, invitacionsRebudes, invitacionsEnviades, anuncis, MODALITATS,
    avisa: req.query.avisa || '', q: req.query });
});

r.post('/elmeucompte', requireLogin, (req, res) => {
  const { nom = '', nivell = '' } = req.body;
  db.prepare('UPDATE users SET name = ?, level = ? WHERE id = ?')
    .run(nom.trim().slice(0, 80), nivell, req.session.user.id);
  req.session.user.name = nom.trim().slice(0, 80);
  res.redirect('/elmeucompte?guardat=1');
});

// Canvi de contrasenya
r.post('/elmeucompte/contrasenya', requireLogin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const { actual = '', nova = '' } = req.body;
  if (!bcrypt.compareSync(actual, user.password_hash) || nova.length < 6) {
    return res.redirect('/elmeucompte?error=contrasenya');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nova, 10), user.id);
  res.redirect('/elmeucompte?contrasenya=ok');
});

// Marcar "m'interessa" / treure
r.post('/torneig/:id/interessa', requireLogin, (req, res) => {
  const t = db.prepare('SELECT id FROM tournaments WHERE id = ? AND status = ?').get(req.params.id, 'published');
  if (!t) return res.sendStatus(404);
  db.prepare('INSERT OR IGNORE INTO interests (user_id, tournament_id) VALUES (?, ?)')
    .run(req.session.user.id, t.id);
  res.redirect(`/torneig/${t.id}`);
});

r.post('/torneig/:id/no-interessa', requireLogin, (req, res) => {
  db.prepare('DELETE FROM interests WHERE user_id = ? AND tournament_id = ?')
    .run(req.session.user.id, req.params.id);
  res.redirect('back');
});

// Seguir / deixar de seguir un club
r.post('/club/:id/segueix', requireLogin, (req, res) => {
  const c = db.prepare('SELECT id FROM clubs WHERE id = ? AND verified = 1').get(req.params.id);
  if (!c) return res.sendStatus(404);
  db.prepare('INSERT OR IGNORE INTO follows (user_id, club_id) VALUES (?, ?)').run(req.session.user.id, c.id);
  res.redirect(`/club/${c.id}`);
});

r.post('/club/:id/no-segueix', requireLogin, (req, res) => {
  db.prepare('DELETE FROM follows WHERE user_id = ? AND club_id = ?').run(req.session.user.id, req.params.id);
  res.redirect('back');
});

// Cerca d'usuaris registrats per nom o email (autocompletat en convidar parella).
// Només comptes verificats: són els únics que poden rebre invitacions.
r.get('/api/cerca-usuaris', requireLogin, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40).replace(/[%_\\]/g, '\\$&');
  if (q.length < 2) return res.json([]);
  const usuaris = db.prepare(`
    SELECT name, email FROM users
    WHERE email_verified = 1 AND (name LIKE '%' || ? || '%' ESCAPE '\\' OR email LIKE '%' || ? || '%' ESCAPE '\\')
    ORDER BY name ASC LIMIT 10`).all(q, q);
  res.json(usuaris);
});

export default r;
