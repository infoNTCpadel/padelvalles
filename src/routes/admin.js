import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware.js';

const r = Router();
r.use(requireRole('admin'));

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
  const clubs = db.prepare('SELECT * FROM clubs ORDER BY verified, name').all();
  res.render('admin/clubs', { titol: 'Clubs', clubs });
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
