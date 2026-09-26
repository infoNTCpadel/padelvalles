import { Router } from 'express';
import db from '../db.js';
import { cartellSVG } from '../poster.js';
import { COMARQUES, MODALITATS } from '../brand.js';

const r = Router();

function getTorneig(id) {
  const t = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble, c.comarca, c.logo_path
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.id = ?`).get(id);
  if (!t) return null;
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  t.club = { name: t.club_nom, town: t.club_poble, logo_path: t.logo_path };
  return t;
}

// Inici
r.get('/', (req, res) => {
  const avui = new Date().toISOString().slice(0, 10);
  const propers = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.status = 'published' AND t.ends_at >= ?
    ORDER BY t.starts_at ASC LIMIT 6`).all(avui);
  const clubs = db.prepare(`SELECT * FROM clubs WHERE verified = 1 ORDER BY name LIMIT 8`).all();
  const totalClubs = db.prepare(`SELECT COUNT(*) AS n FROM clubs WHERE verified = 1`).get().n;
  res.render('index', { titol: 'Inici', propers, clubs, totalClubs, COMARQUES });
});

// Llistat de tornejos amb filtres
r.get('/tornejos', (req, res) => {
  const { comarca = '', club = '', modalitat = '', q = '', mes = '' } = req.query;
  const avui = new Date().toISOString().slice(0, 10);
  let sql = `
    SELECT DISTINCT t.*, c.name AS club_nom, c.town AS club_poble, c.comarca
    FROM tournaments t
    JOIN clubs c ON c.id = t.club_id
    LEFT JOIN tournament_categories tc ON tc.tournament_id = t.id
    WHERE t.status = 'published' AND t.ends_at >= ?`;
  const p = [avui];
  if (comarca) { sql += ' AND c.comarca = ?'; p.push(comarca); }
  if (club) { sql += ' AND t.club_id = ?'; p.push(Number(club)); }
  if (modalitat) { sql += ' AND tc.modality = ?'; p.push(modalitat); }
  if (q) { sql += ' AND (t.name LIKE ? OR c.name LIKE ? OR c.town LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (mes) { sql += ` AND strftime('%Y-%m', t.starts_at) = ?`; p.push(mes); }
  sql += ' ORDER BY t.starts_at ASC';
  const tornejos = db.prepare(sql).all(...p);
  const clubs = db.prepare('SELECT id, name FROM clubs WHERE verified = 1 ORDER BY name').all();
  res.render('tornejos', { titol: 'Tornejos', tornejos, clubs, filtres: { comarca, club, modalitat, q, mes }, COMARQUES, MODALITATS });
});

// Fitxa del torneig
r.get('/torneig/:id', (req, res) => {
  const t = getTorneig(req.params.id);
  if (!t || t.status !== 'published') return res.status(404).render('404', { titol: 'Torneig no trobat' });
  let interessat = false;
  if (req.session.user) {
    interessat = !!db.prepare('SELECT 1 FROM interests WHERE user_id = ? AND tournament_id = ?')
      .get(req.session.user.id, t.id);
  }
  res.render('torneig', { titol: t.name, t, interessat, MODALITATS, avis: req.query.avis });
});

// Cartell generat automàticament (SVG amb la marca). Accessible sempre perquè
// el club i l'admin el puguin previsualitzar abans de publicar.
r.get('/torneig/:id/cartell.svg', (req, res) => {
  const t = getTorneig(req.params.id);
  if (!t) return res.sendStatus(404);
  res.type('image/svg+xml').send(cartellSVG(t, t.club));
});

// Directorio de clubs
r.get('/clubs', (req, res) => {
  const { comarca = '' } = req.query;
  const q = String(req.query.q || '').trim();
  let sql = 'SELECT * FROM clubs WHERE verified = 1';
  const p = [];
  if (comarca) { sql += ' AND comarca = ?'; p.push(comarca); }
  if (q) { sql += ' AND (name LIKE ? OR town LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY town, name';
  const clubs = db.prepare(sql).all(...p);
  res.render('clubs', { titol: 'Clubs', clubs, comarca, q, COMARQUES });
});

// Fitxa del club
r.get('/club/:id', (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id = ? AND verified = 1').get(req.params.id);
  if (!club) return res.status(404).render('404', { titol: 'Club no trobat' });
  const avui = new Date().toISOString().slice(0, 10);
  const tornejos = db.prepare(`
    SELECT * FROM tournaments
    WHERE club_id = ? AND status = 'published' AND ends_at >= ?
    ORDER BY starts_at ASC`).all(club.id, avui);
  let segueix = false;
  if (req.session.user) {
    segueix = !!db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND club_id = ?').get(req.session.user.id, club.id);
  }
  res.render('club', { titol: club.name, club, tornejos, segueix, COMARQUES });
});

// Avisar l'admin d'un torneig sospitós (promoció encoberta, dades errònies...)
r.post('/torneig/:id/avis', (req, res) => {
  const t = getTorneig(req.params.id);
  if (!t) return res.sendStatus(404);
  const missatge = String(req.body.missatge || '').slice(0, 500).trim();
  if (!missatge) return res.redirect(`/torneig/${t.id}?avis=buit`);
  db.prepare('INSERT INTO reports (tournament_id, reporter_email, message) VALUES (?, ?, ?)')
    .run(t.id, req.session.user?.email || '', missatge);
  res.redirect(`/torneig/${t.id}?avis=enviat`);
});

// Pàgines legals (text breu de mostra; cal revisar amb assessor)
r.get('/avis-legal', (req, res) => res.render('legal', { titol: 'Avís legal', pagina: 'avis' }));
r.get('/privacitat', (req, res) => res.render('legal', { titol: 'Política de privacitat', pagina: 'privacitat' }));
r.get('/cookies', (req, res) => res.render('legal', { titol: 'Política de cookies', pagina: 'cookies' }));

export default r;
