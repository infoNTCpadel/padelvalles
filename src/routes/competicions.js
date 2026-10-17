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
  creaCompeticionsBulk, agafaCompeticio, participantsDe, fixaSeed,
  canviaEstatParticipant, commutaPagatParticipant,
} from '../lib/competicions.js';
import {
  llegirConfig, desaConfig, generaQuadre, esborraQuadre, desaResultat,
  esborraResultat, programaPartit, quadreDe, teQuadreGenerat, teResultats,
  ETIQUETA_RONDA,
} from '../lib/quadre.js';

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
    if (t.servei !== 'torneig') return res.status(400).send('Aquest torneig no té el servei Torneig.');
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
      if (t.servei !== 'torneig') throw new Error('Aquest torneig no té el servei Torneig.');
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
    if (t.servei !== 'torneig') return res.status(400).send('Aquest torneig no té el servei Torneig.');
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
      if (t.servei !== 'torneig') throw new Error('Aquest torneig no té el servei Torneig.');
      const formats = req.body.formats || {};
      // El formulari envia formats[cat_<id>] (el prefix evita que qs ho parsegi com a array)
      const items = Object.entries(formats)
        .map(([k, format]) => ({ category_id: String(k).replace(/^cat_/, ''), format }))
        .filter(it => /^\d+$/.test(it.category_id));
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
      creada: req.query.creada || null,
      errorMsg: req.query.error || null,
    });
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

  // --- Configurador de la competició (característiques editables) ---
  r.get(`${base}/torneig/:tid/competicio/:cid/configura`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    res.render('competicio-config', {
      titol: 'Configura: ' + comp.name, t, base, comp,
      cfg: llegirConfig(comp), FORMATS, ESTATS_COMPETICIO,
      desat: req.query.desat || null, error: req.query.error || null,
    });
  });

  r.post(`${base}/torneig/:tid/competicio/:cid/configura`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const enrere = `${base}/torneig/${t.id}/competicio/${comp.id}/configura`;
    try {
      if (teQuadreGenerat(comp.id)) throw new Error('Amb el quadre generat, la configuració del sorteig ja no es pot canviar. Esborra el quadre primer.');
      const cfgNou = desaConfig(comp.id, {
        num_seeds: req.body.num_seeds,
        draw_size: req.body.draw_size,
        super_tiebreak: req.body.super_tiebreak,
        pistes: req.body.pistes,
        min_parelles: req.body.min_parelles,
      });
      const updates = [];
      if (req.body.nom && req.body.nom.trim()) updates.push(['name', req.body.nom.trim().slice(0, 120)]);
      if (req.body.quota_text !== undefined) updates.push(['fee_text', String(req.body.quota_text || '').slice(0, 80)]);
      const nouEstat = String(req.body.status || '');
      if (nouEstat && ESTATS_COMPETICIO[nouEstat] && ['draft', 'inscripcio'].includes(nouEstat)) updates.push(['status', nouEstat]);
      for (const [col, val] of updates) db.prepare(`UPDATE competitions SET ${col} = ? WHERE id = ?`).run(val, comp.id);
      db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail) VALUES (?, ?, 'configura', ?)`)
        .run(comp.id, req.session.user.id, JSON.stringify(cfgNou));
      res.redirect(enrere + '?desat=1');
    } catch (e) {
      res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
    }
  });

  // --- Quadre: vista de gestió (organitzador) ---
  r.get(`${base}/torneig/:tid/competicio/:cid/quadre`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const q = quadreDe(comp.id);
    const actius = participantsDe(comp.id, false);
    res.render('club-quadre', {
      titol: 'Quadre: ' + comp.name, t, base, comp, quadre: q,
      nActius: actius.length, ambSeed: actius.filter(p => p.seed !== null && p.seed !== undefined).length,
      teResultats: teResultats(comp.id),
      ETIQUETA_RONDA, FORMATS, ESTATS_COMPETICIO,
      msg: req.query.msg || null, errorMsg: req.query.error || null,
    });
  });

  r.post(`${base}/torneig/:tid/competicio/:cid/quadre/genera`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const enrere = `${base}/torneig/${t.id}/competicio/${comp.id}/quadre`;
    try {
      const r = generaQuadre(comp.id, req.session.user.id);
      let msg = `Quadre de ${r.draw} generat amb ${r.parelles} parelles (${r.byes} byes).`;
      if (r.avisaMinim) msg += ' Atenció: menys parelles del mínim configurat.';
      res.redirect(enrere + '?msg=' + encodeURIComponent(msg));
    } catch (e) {
      res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
    }
  });

  r.post(`${base}/torneig/:tid/competicio/:cid/quadre/esborra`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const enrere = `${base}/torneig/${t.id}/competicio/${comp.id}/quadre`;
    try {
      esborraQuadre(comp.id, req.session.user.id);
      res.redirect(enrere + '?msg=' + encodeURIComponent('Quadre esborrat. Pots tornar a generar-lo.'));
    } catch (e) {
      res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
    }
  });

  // --- Resultats ---
  function accioPartit(sufix, fn) {
    r.post(`${base}/torneig/:tid/competicio/:cid/partit/:mid/${sufix}`, ...cfg.middlewares, (req, res) => {
      const t = cfg.agafaTorneig(req, res);
      if (!t) return;
      if (!exigeixCreador(req, res, t)) return;
      const comp = agafaComp(req, res, t);
      if (!comp) return;
      const enrere = `${base}/torneig/${t.id}/competicio/${comp.id}/quadre`;
      try {
        fn(req, comp);
        res.redirect(enrere + '?msg=' + encodeURIComponent('Resultat desat. El guanyador avança automàticament.'));
      } catch (e) {
        res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
      }
    });
  }

  accioPartit('resultat', (req, comp) => {
    desaResultat(Number(req.params.mid), comp.id, {
      tipus: req.body.tipus, guanyador: req.body.guanyador,
      s1a: req.body.s1a, s1b: req.body.s1b,
      s2a: req.body.s2a, s2b: req.body.s2b,
      s3a: req.body.s3a, s3b: req.body.s3b,
      stb_a: req.body.stb_a, stb_b: req.body.stb_b,
      notes: req.body.notes,
    }, req.session.user.id);
  });

  r.post(`${base}/torneig/:tid/competicio/:cid/partit/:mid/resultat/esborra`, ...cfg.middlewares, (req, res) => {
    const t = cfg.agafaTorneig(req, res);
    if (!t) return;
    if (!exigeixCreador(req, res, t)) return;
    const comp = agafaComp(req, res, t);
    if (!comp) return;
    const enrere = `${base}/torneig/${t.id}/competicio/${comp.id}/quadre`;
    try {
      esborraResultat(Number(req.params.mid), comp.id, req.session.user.id);
      res.redirect(enrere + '?msg=' + encodeURIComponent('Resultat esborrat.'));
    } catch (e) {
      res.redirect(enrere + '?error=' + encodeURIComponent(e.message));
    }
  });

  accioPartit('programa', (req, comp) => {
    programaPartit(Number(req.params.mid), comp.id, {
      scheduled_at: req.body.scheduled_at, pista: req.body.pista,
    }, req.session.user.id);
  });

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
