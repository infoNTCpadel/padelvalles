// Rutes de gestió de competicions (Fase 1).
// Factoría: mateixes rutes per a club (/club) i organitzador (/organitzador),
// canviant només la base, els middlewares i com es resol el torneig i el creador.
//
// cfg: {
//   base: '/club' | '/organitzador',
//   middlewares: [...],
//   agafaTorneig(req, res) -> torneig | null  (llegeix req.params.tid; 404 si no hi ha accés)
//   esGestor(req, t) -> bool
//   getOrganitzador(req) -> organitzador | null  (només context organitzador)
// }
import { Router } from 'express';
import db from '../db.js';
import { MODALITATS } from '../brand.js';
import {
  FORMATS, ESTATS_COMPETICIO, resolCreador, competicionsDe, creaCompeticio,
  creaCompeticionsBulk, importaInscrits, agafaCompeticio, participantsDe, fixaSeed,
  canviaEstatParticipant, commutaPagatParticipant,
} from '../lib/competicions.js';

export function rutesCompeticio(cfg) {
  const r = Router();
  const { base } = cfg;

  const creadorDe = (req, t) => resolCreador(req.session.user, t, {
    esGestor: cfg.esGestor(req, t),
    organitzador: cfg.getOrganitzador ? cfg.getOrganitzador(req) : null,
  });

  function exigeixCreador(req, res, t) {
    const c = creadorDe(req, t);
    if (!c) { res.status(403).send('Accés denegat.'); return null; }
    return c;
  }

  function agafaComp(req, res, t) {
    const comp = agafaCompeticio(req.params.cid, t.id);
    if (!comp) { res.status(404).render('404', { titol: 'No trobat' }); return null; }
    return comp;
  }

  const nomesPV = (t) => (t.registration_mode || 'externa') === 'padelvalles';

  // --- Formulari: crear la competició d'una categoria ---
  r.get(`${base}/torneig/:tid/competicio/nova`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    if (!nomesPV(t)) return res.status(400).send('Aquest torneig no té la inscripció a PadelVallès.');
    const categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
    const { perCat } = competicionsDe(t.id);
    const lliures = categories.filter(c => !perCat[c.id]);
    if (!lliures.length) return res.redirect(`${base}/torneig/${t.id}/inscrits`);
    res.render('competicio-form', {
      titol: 'Nova competició', t, base, categories: lliures, FORMATS, MODALITATS,
      sel: req.query.categoria || lliures[0].id, error: null,
    });
  });

  r.post(`${base}/torneig/:tid/competicio/nova`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    const creador = exigeixCreador(req, res, t);
    if (!creador) return;
    const refer = (error) => {
      const categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
      const { perCat } = competicionsDe(t.id);
      const lliures = categories.filter(c => !perCat[c.id]);
      res.render('competicio-form', {
        titol: 'Nova competició', t, base, categories: lliures, FORMATS, MODALITATS,
        sel: req.body.categoria, error,
      });
    };
    try {
      if (!nomesPV(t)) throw new Error('Aquest torneig no té la inscripció a PadelVallès.');
      const { id } = creaCompeticio({
        tournament_id: t.id, category_id: Number(req.body.categoria),
        format: String(req.body.format || 'eliminatoria'), name: req.body.nom,
        fee_text: req.body.quota_text, fee_amount: req.body.quota_import,
        creador, actorId: req.session.user.id,
      });
      res.redirect(`${base}/torneig/${t.id}/competicio/${id}?creada=1`);
    } catch (e) { refer(e.message); }
  });

  // --- Crear TOTES les competicions del torneig d'una vegada ---
  // Una per categoria (fins i tot les sense inscrits), amb les parelles ja importades.
  function dadesBulk(t) {
    const categories = db.prepare('SELECT * FROM tournament_categories WHERE tournament_id = ?').all(t.id);
    const { perCat } = competicionsDe(t.id);
    const counts = {};
    const q = db.prepare(`SELECT COUNT(*) n FROM registrations WHERE category_id = ? AND status = 'registered'`);
    for (const c of categories) counts[c.id] = q.get(c.id).n;
    return { categories, perCat, counts };
  }

  r.get(`${base}/torneig/:tid/competicions/nova`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    if (!nomesPV(t)) return res.status(400).send('Aquest torneig no té la inscripció a PadelVallès.');
    res.render('competicions-form', {
      titol: 'Crea les competicions', t, base, ...dadesBulk(t), FORMATS, MODALITATS, error: null,
    });
  });

  r.post(`${base}/torneig/:tid/competicions/nova`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    const creador = exigeixCreador(req, res, t);
    if (!creador) return;
    try {
      if (!nomesPV(t)) throw new Error('Aquest torneig no té la inscripció a PadelVallès.');
      const formats = req.body.formats || {};
      const items = Object.entries(formats).map(([category_id, format]) => ({ category_id, format }));
      const { creades } = creaCompeticionsBulk({
        tournament_id: t.id, items,
        fee_text: req.body.quota_text, fee_amount: req.body.quota_import,
        creador, actorId: req.session.user.id,
      });
      res.redirect(`${base}/torneig/${t.id}/inscrits?creades=${creades.length}`);
    } catch (e) {
      res.render('competicions-form', {
        titol: 'Crea les competicions', t, base, ...dadesBulk(t), FORMATS, MODALITATS, error: e.message,
      });
    }
  });

  // --- Gestionar la competició: participants ---
  r.get(`${base}/torneig/:tid/competicio/:cid`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const cat = db.prepare('SELECT * FROM tournament_categories WHERE id = ?').get(comp.category_id);
    const etiquetaCat = cat
      ? `${MODALITATS[cat.modality] || cat.modality}${cat.level ? ' · ' + cat.level : ''}` : '';
    const participants = participantsDe(comp.id, true);
    res.render('club-competicio', {
      titol: comp.name, t, base, comp, etiquetaCat,
      participants, actius: participants.filter(p => p.status === 'active'),
      FORMATS, ESTATS_COMPETICIO,
      creada: req.query.creada || null, sinc: req.query.sinc || null,
      errorMsg: req.query.error || null,
    });
  });

  // --- Sincronitza: importa les inscripcions confirmades noves ---
  r.post(`${base}/torneig/:tid/competicio/:cid/sincronitza`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const n = importaInscrits(comp.id, comp.category_id);
    db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail)
                VALUES (?, ?, 'sincronitza', ?)`)
      .run(comp.id, req.session.user.id, `importades=${n}`);
    res.redirect(`${base}/torneig/${t.id}/competicio/${comp.id}?sinc=${n}`);
  });

  // --- Accions sobre un participant ---
  function accioParticipant(nomAccio, fn) {
    r.post(`${base}/torneig/:tid/competicio/:cid/participants/:eid/${nomAccio}`, ...cfg.middlewares, (req, res) => {
      const t = cfg.agafaTorneig(req, res);
      if (!t) return;
      if (!exigeixCreador(req, res, t)) return;
      const comp = agafaComp(req, res, t);
      if (!comp) return;
      const enrere = `${base}/torneig/${t.id}/competicio/${comp.id}`;
      try {
        fn(req, comp);
        res.redirect(enrere);
      } catch (e) {
        res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
      }
    });
  }

  accioParticipant('seed', (req, comp) => {
    fixaSeed(req.params.eid, comp.id, req.body.seed);
    db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail)
                VALUES (?, ?, 'seed', ?)`)
      .run(comp.id, req.session.user.id, `entry=${req.params.eid} seed=${req.body.seed || '—'}`);
  });
  accioParticipant('pagat', (req, comp) => commutaPagatParticipant(req.params.eid, comp.id));
  accioParticipant('treu', (req, comp) => canviaEstatParticipant(req.params.eid, comp.id, 'withdrawn'));
  accioParticipant('reactiva', (req, comp) => canviaEstatParticipant(req.params.eid, comp.id, 'active'));

  return r;
}
