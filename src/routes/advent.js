// Calendari d'Advent — mòdul OCULT: la ruta existeix però cap pàgina del web
// hi enllaça (ni menú, ni portada, ni sitemap) i porta noindex. Només hi
// arriba qui té l'enllaç directe (campanyes, xarxes, boca-orella).
import { Router } from 'express';
import db, { transaccio } from '../db.js';
import { requireLogin } from '../middleware.js';
import {
  estatCalendari, totalParticipacions, codiReferitDe, ranquing, comprovaRatxa,
  VALOR_GRAN_PREMI, MAX_REFERITS,
} from '../lib/advent.js';

const r = Router();

function noindex(res) {
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

r.get('/calendari', (req, res) => {
  noindex(res);
  // Enllaç de referit: es desa el codi a la sessió i es porta al registre
  const ref = String(req.query.ref || '').trim().toUpperCase();
  if (ref) {
    if (!req.session.user) {
      req.session.refCode = ref.slice(0, 16);
      return res.redirect('/registre?next=' + encodeURIComponent('/calendari'));
    }
    return res.redirect('/calendari');
  }

  const est = estatCalendari();
  const dies = db.prepare('SELECT * FROM advent_days ORDER BY day').all();
  const guanyadors = {}; // dia -> nom del guanyador del sorteig diari
  for (const d of db.prepare(`
    SELECT dr.day, u.name FROM advent_draws dr JOIN users u ON u.id = dr.winner_user_id
    WHERE dr.scope = 'daily'`).all()) guanyadors[d.day] = d.name;
  const finalDraw = db.prepare(`
    SELECT u.name FROM advent_draws dr JOIN users u ON u.id = dr.winner_user_id
    WHERE dr.scope = 'final'`).get();

  let meu = null;
  let obertAvui = null;
  if (req.session.user) {
    const uid = req.session.user.id;
    const obertes = db.prepare('SELECT day, correct FROM advent_opens WHERE user_id = ?').all(uid);
    const obertesMap = new Map(obertes.map(o => [o.day, o]));
    const codi = codiReferitDe(uid);
    const enllac = `${res.locals.appUrl}/calendari?ref=${codi}`;
    meu = {
      participacions: totalParticipacions(uid),
      obertes: obertes.length,
      obertesMap,
      codi,
      enllac,
      amics: db.prepare(`SELECT COUNT(*) n FROM advent_entries WHERE user_id = ? AND source = 'referral'`).get(uid).n,
      whatsapp: 'https://wa.me/?text=' + encodeURIComponent(
        `🎄 Participa al Calendari d'Advent de PadelVallès: un regal de pàdel cada dia i un gran premi final valorat en ${VALOR_GRAN_PREMI} €. Registra't amb el meu enllaç: ${enllac}`),
    };
    if (est.fase === 'durant') obertAvui = obertesMap.get(est.dia) || null;
  }

  let diaAvui = null;
  let quizOpcions = [];
  if (est.fase === 'durant') {
    diaAvui = dies.find(d => d.day === est.dia) || null;
    if (diaAvui && diaAvui.type === 'quiz') {
      try { quizOpcions = JSON.parse(diaAvui.quiz_options || '[]'); } catch { quizOpcions = []; }
    }
  }

  res.render('advent', {
    titol: "Calendari d'Advent", noindex: true,
    est, dies, guanyadors, finalDraw: finalDraw || null,
    meu, diaAvui, quizOpcions, obertAvui,
    ranking: ranquing(10),
    valorGranPremi: VALOR_GRAN_PREMI, maxReferits: MAX_REFERITS,
    obert: req.query.obert ? parseInt(req.query.obert, 10) : null,
  });
});

// Obrir la casella d'avui (cal sessió): +1 participació, +1 si el quiz s'encerta
r.post('/calendari/obre', requireLogin, (req, res) => {
  const est = estatCalendari();
  if (est.fase !== 'durant') return res.redirect('/calendari');
  const dia = est.dia; // el dia sempre és el del servidor; el client no el tria
  const info = db.prepare('SELECT * FROM advent_days WHERE day = ?').get(dia);
  if (!info) return res.redirect('/calendari');
  const uid = req.session.user.id;
  if (db.prepare('SELECT 1 FROM advent_opens WHERE user_id = ? AND day = ?').get(uid, dia)) {
    return res.redirect('/calendari');
  }
  let correct = null;
  if (info.type === 'quiz') {
    const resposta = parseInt(req.body.resposta, 10);
    correct = (!Number.isNaN(resposta) && resposta === info.quiz_correct) ? 1 : 0;
  }
  try {
    transaccio(() => {
      db.prepare('INSERT INTO advent_opens (user_id, day, correct) VALUES (?, ?, ?)').run(uid, dia, correct);
      db.prepare(`INSERT INTO advent_entries (user_id, source, points) VALUES (?, 'open', 1)`).run(uid);
      if (correct === 1) {
        db.prepare(`INSERT INTO advent_entries (user_id, source, points) VALUES (?, 'quiz', 1)`).run(uid);
      }
    });
    comprovaRatxa(uid, dia);
  } catch { /* obertura duplicada per doble enviament: ja compta */ }
  res.redirect('/calendari?obert=' + dia);
});

// Bases legals de la promoció (enllaçades només des de la pròpia pàgina)
r.get('/calendari/bases', (req, res) => {
  noindex(res);
  const dies = db.prepare('SELECT * FROM advent_days ORDER BY day').all();
  res.render('advent-bases', {
    titol: 'Bases legals del Calendari d’Advent', noindex: true,
    dies, valorGranPremi: VALOR_GRAN_PREMI, maxReferits: MAX_REFERITS,
  });
});

export default r;
