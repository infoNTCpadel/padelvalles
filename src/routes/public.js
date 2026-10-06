import { Router } from 'express';
import db from '../db.js';
import { cartellSVG } from '../poster.js';
import { COMARQUES, MODALITATS, TIPUS_TORNEIG, estatTorneig, nomNivell } from '../brand.js';
import { inscripcioOberta, placesCategoria, inscripcionsDe, potDesapuntar } from '../lib/inscripcions.js';
import { competicionsDe, FORMATS } from '../lib/competicions.js';

const r = Router();

function getTorneig(id) {
  const t = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble, c.comarca, c.logo_path, c.claimed AS club_claimed,
      o.id AS org_id, o.name AS org_nom
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    LEFT JOIN organizers o ON o.id = t.organizer_id
    WHERE t.id = ? AND c.verified = 1`).get(id);
  if (!t) return null;
  t.categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
  t.club = { name: t.club_nom, town: t.club_poble, logo_path: t.logo_path };
  return t;
}

// Inici
r.get('/', (req, res) => {
  const avui = new Date().toISOString().slice(0, 10);
  const propers = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble, c.claimed AS club_claimed
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.status = 'published' AND t.ends_at >= ? AND c.verified = 1
    ORDER BY t.starts_at ASC LIMIT 6`).all(avui);
  const clubs = db.prepare(`SELECT * FROM clubs WHERE verified = 1 ORDER BY name LIMIT 8`).all();
  const totalClubs = db.prepare(`SELECT COUNT(*) AS n FROM clubs WHERE verified = 1`).get().n;
  const totalTornejos = db.prepare(`SELECT COUNT(*) AS n FROM tournaments t JOIN clubs c ON c.id = t.club_id WHERE t.status = 'published' AND t.ends_at >= ? AND c.verified = 1`).get(avui).n;
  res.render('index', { titol: 'Inici', propers, clubs, totalClubs, totalTornejos, COMARQUES, estatTorneig });
});

// Llistat de tornejos amb filtres (inclou els finalitzats dels últims 60 dies com a historial)
r.get('/tornejos', (req, res) => {
  const { comarca = '', club = '', modalitat = '', q = '', mes = '' } = req.query;
  const avui = new Date().toISOString().slice(0, 10);
  let sql = `
    SELECT DISTINCT t.*, c.name AS club_nom, c.town AS club_poble, c.comarca, c.claimed AS club_claimed
    FROM tournaments t
    JOIN clubs c ON c.id = t.club_id
    LEFT JOIN tournament_categories tc ON tc.tournament_id = t.id
    WHERE t.status = 'published' AND t.ends_at >= date('now', '-60 days') AND c.verified = 1`;
  const p = [];
  if (comarca) { sql += ' AND c.comarca = ?'; p.push(comarca); }
  if (club) { sql += ' AND t.club_id = ?'; p.push(Number(club)); }
  if (modalitat) { sql += ' AND tc.modality = ?'; p.push(modalitat); }
  if (q) { sql += ' AND (t.name LIKE ? OR c.name LIKE ? OR c.town LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (mes) { sql += ` AND strftime('%Y-%m', t.starts_at) = ?`; p.push(mes); }
  sql += ' ORDER BY t.starts_at ASC';
  const tots = db.prepare(sql).all(...p);
  // Primer els vigents, després l'historial recent
  const tornejos = [
    ...tots.filter(t => t.ends_at >= avui),
    ...tots.filter(t => t.ends_at < avui).reverse(),
  ];
  const clubs = db.prepare('SELECT id, name FROM clubs WHERE verified = 1 ORDER BY name').all();
  res.render('tornejos', { titol: 'Tornejos', tornejos, clubs, filtres: { comarca, club, modalitat, q, mes }, COMARQUES, MODALITATS, estatTorneig });
});

// Fitxa del torneig
r.get('/torneig/:id', (req, res) => {
  const t = getTorneig(req.params.id);
  if (!t || t.status !== 'published') return res.status(404).render('404', { titol: 'Torneig no trobat' });
  let interessat = false;
  const base = process.env.APP_URL || 'https://padelvalles.com';
  const canonical = `${base}/torneig/${t.id}`;
  const metaDescription = `${t.name}: torneig de pàdel al ${t.club_nom} (${t.club_poble}), del ${t.starts_at} al ${t.ends_at}. Registra't gratis a PadelVallès per veure el cartell, el preu i com inscriure-t'hi.`;
  const ogImage = `${base}/torneig/${t.id}/cartell.svg`;
  const shareText = `Mira aquest torneig de pàdel: ${t.name} (${t.starts_at} – ${t.ends_at}) al ${t.club_nom} de ${t.club_poble}`;

  // Dades d'inscripció (fase 2)
  const modePV = (t.registration_mode || 'externa') === 'padelvalles';
  const oberta = modePV && inscripcioOberta(t);
  let lesMeves = [], elMeuAnunci = null;
  const places = {};
  const cercadors = [];
  if (modePV) {
    for (const c of t.categories) places[c.id] = placesCategoria(c.id);
    const rows = db.prepare(`
      SELECT ps.*, u.name AS nom, tc.modality AS cat_modality, tc.level AS cat_level
      FROM partner_search ps JOIN users u ON u.id = ps.user_id
      LEFT JOIN tournament_categories tc ON tc.id = ps.category_id
      WHERE ps.tournament_id = ? AND ps.status = 'open' ORDER BY ps.created_at`).all(t.id);
    for (const ps of rows) {
      ps.etiqueta = (MODALITATS[ps.cat_modality || ps.modality] || (ps.cat_modality || ps.modality)) +
        ((ps.cat_level || ps.level) ? ' · ' + (ps.cat_level || ps.level) : '');
      if (req.session.user && ps.user_id === req.session.user.id) elMeuAnunci = ps;
      else cercadors.push(ps);
    }
  }
  if (req.session.user) {
    interessat = !!db.prepare('SELECT 1 FROM interests WHERE user_id = ? AND tournament_id = ?')
      .get(req.session.user.id, t.id);
    lesMeves = inscripcionsDe(t.id, req.session.user.id);
    for (const m of lesMeves) {
      m.jug1 = db.prepare('SELECT id, name FROM users WHERE id = ?').get(m.player1_id);
      m.jug2 = db.prepare('SELECT id, name FROM users WHERE id = ?').get(m.player2_id);
      m.socJo1 = m.player1_id === req.session.user.id;
      m.pucDesapuntar = ['registered', 'waitlist'].includes(m.status) && potDesapuntar(t);
      if (m.status === 'waitlist') {
        m.posicio = db.prepare(`
          SELECT COUNT(*) n FROM registrations
          WHERE tournament_id = ? AND category_id = ? AND status = 'waitlist'
            AND (decided_at < ? OR (decided_at = ? AND id <= ?))`)
          .get(t.id, m.category_id, m.decided_at, m.decided_at, m.id).n;
      }
    }
  }
  const MISS = {
    'invitacio-enviada': 'Invitació enviada. La plaça es confirmarà quan la teva parella accepti la invitació.',
    'invitacio-acceptada': 'Invitació acceptada. La vostra parella ja està inscrita al torneig!',
    'en-espera': 'Categoria plena: esteu en llista d\u2019espera. T\u2019avisarem si s\u2019allibera alguna plaça.',
    'invitacio-rebutjada': 'Has rebutjat la invitació.',
    'invitacio-cancelada': 'Invitació cancel·lada.',
    'baixa-feta': 'Us heu donat de baixa de la inscripció.',
    'anunci-publicat': 'Anunci publicat. Quan algú et proposi fer parella, rebràs la invitació aquí i per email.',
    'anunci-tret': 'Anunci retirat.',
    'proposta-enviada': 'Proposta enviada. Si l\u2019accepta, quedareu inscrits com a parella.',
  };
  // Recompte d'inscrits per categoria: només si la inscripció es fa a PadelVallès.
  // Amb inscripció externa no hi ha inscrits controlables i la secció s'amaga.
  let inscritsPerCat;
  if (modePV) {
    inscritsPerCat = {};
    for (const c of t.categories) {
      const parelles = db.prepare(`
        SELECT player1_name, player2_name FROM registrations
        WHERE category_id = ? AND status = 'registered' ORDER BY decided_at ASC, id ASC`).all(c.id);
      inscritsPerCat[c.id] = {
        n: parelles.length,
        max: c.max_pairs,
        parelles: t.mostra_inscrits ? parelles : [],
      };
    }
  }
  const estat = estatTorneig(t);
  const { perCat: competicionsPerCat } = competicionsDe(t.id);
  res.render('torneig', { titol: t.name, t, interessat, MODALITATS, TIPUS_TORNEIG, avis: req.query.avis,
    missatge: MISS[req.query.avis] || null, errorMsg: req.query.error || null,
    modePV, oberta, lesMeves, places, cercadors, elMeuAnunci, inscritsPerCat, estat,
    competicionsPerCat, FORMATS,
    metaDescription, canonical, ogImage, shareText, shareUrl: canonical });
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

// Directori de jugadors: nom + rol (+ nivell), sense cap altra dada personal
const ROLS_JUGADORS = { player: 'Jugador', club: 'Club', monitor: 'Monitor', admin: 'Equip PadelVallès' };
r.get('/jugadors', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  let sql = `SELECT name, role, level FROM users WHERE email_verified = 1 AND role IN ('player','club','monitor','admin')`;
  const p = [];
  if (q) { sql += ' AND name LIKE ?'; p.push(`%${q}%`); }
  sql += ' ORDER BY name';
  const jugadors = db.prepare(sql).all(...p).map(u => ({
    nom: u.name,
    rol: ROLS_JUGADORS[u.role] || 'Jugador',
    rolClau: u.role,
    nivell: u.level ? nomNivell(u.level) : ''
  }));
  res.render('jugadors', { titol: 'Jugadors', jugadors, q });
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
  res.render('club', { titol: club.name, club, tornejos, segueix, COMARQUES,
    metaDescription: `${club.name}: club de pàdel a ${club.town} (${COMARQUES[club.comarca] || ''}). Consulta els seus tornejos a PadelVallès.`,
    canonical: `${process.env.APP_URL || 'https://padelvalles.com'}/club/${club.id}` });
});

// Fitxa pública de l'organitzador
r.get('/organitzador/:id', (req, res) => {
  const org = db.prepare(`SELECT * FROM organizers WHERE id = ? AND status = 'approved'`).get(req.params.id);
  if (!org) return res.status(404).render('404', { titol: 'Organitzador no trobat' });
  const avui = new Date().toISOString().slice(0, 10);
  const tornejos = db.prepare(`
    SELECT t.*, c.name AS club_nom, c.town AS club_poble
    FROM tournaments t JOIN clubs c ON c.id = t.club_id
    WHERE t.organizer_id = ? AND t.status = 'published' AND t.ends_at >= ? AND c.verified = 1
    ORDER BY t.starts_at ASC`).all(org.id, avui);
  res.render('organitzador', { titol: org.name, org, tornejos,
    metaDescription: `${org.name}: organitzador independent de tornejos de pàdel al Vallès. Consulta els seus tornejos a PadelVallès.`,
    canonical: `${process.env.APP_URL || 'https://padelvalles.com'}/organitzador/${org.id}` });
});

// SEO: sitemap.xml amb tornejos publicats i clubs verificats
r.get('/sitemap.xml', (req, res) => {
  const base = process.env.APP_URL || 'https://padelvalles.com';
  const urls = [
    { loc: base + '/', changefreq: 'daily', priority: '1.0' },
    { loc: base + '/tornejos', changefreq: 'daily', priority: '0.9' },
    { loc: base + '/clubs', changefreq: 'weekly', priority: '0.8' },
  ];
  const tornejos = db.prepare(`SELECT t.id, COALESCE(t.published_at, t.created_at) AS lm FROM tournaments t JOIN clubs c ON c.id = t.club_id WHERE t.status = 'published' AND c.verified = 1 ORDER BY t.starts_at DESC`).all();
  for (const t of tornejos) urls.push({ loc: `${base}/torneig/${t.id}`, changefreq: 'weekly', priority: '0.9', lastmod: String(t.lm || '').slice(0, 10) });
  const clubs = db.prepare('SELECT id FROM clubs WHERE verified = 1 ORDER BY name').all();
  for (const c of clubs) urls.push({ loc: `${base}/club/${c.id}`, changefreq: 'weekly', priority: '0.7' });
  const orgs = db.prepare(`SELECT id FROM organizers WHERE status = 'approved' ORDER BY name`).all();
  for (const o of orgs) urls.push({ loc: `${base}/organitzador/${o.id}`, changefreq: 'weekly', priority: '0.7' });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${u.loc}</loc>` +
      (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
      `<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>';
  res.type('application/xml').send(xml);
});

r.get('/robots.txt', (req, res) => {
  const base = process.env.APP_URL || 'https://padelvalles.com';
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
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
