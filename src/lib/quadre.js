// Motor del quadre d'eliminatòria (Fase 2a).
// Genera el sorteig (mida = potència de 2, byes, caps de sèrie), registra
// resultats amb avanç automàtic del guanyador i gestiona la programació.
import db, { transaccio } from '../db.js';
import { participantsDe } from './competicions.js';

// --- Config per defecte (competitions.config és JSON) ---
export const CONFIG_QUADRE_DEFECTE = {
  num_seeds: 4,        // quants caps de sèrie es protegeixen
  draw_size: 0,        // 0 = automàtic (següent potència de 2); si no, 4/8/16/32/64/128
  super_tiebreak: true,// el 3r set es juga com a super tie-break a 10
  pistes: [],          // llista de pistes disponibles
  min_parelles: 4,     // mínim esportiu (avís, no bloqueig); el tècnic és 2
};

export function llegirConfig(comp) {
  let c = {};
  try { c = JSON.parse(comp.config || '{}'); } catch { c = {}; }
  return { ...CONFIG_QUADRE_DEFECTE, ...c };
}

export function desaConfig(competitionId, cfg) {
  const net = {
    num_seeds: Math.max(0, Math.min(64, Number(cfg.num_seeds ?? CONFIG_QUADRE_DEFECTE.num_seeds) || 0)),
    draw_size: [0, 4, 8, 16, 32, 64, 128].includes(Number(cfg.draw_size)) ? Number(cfg.draw_size) : 0,
    super_tiebreak: cfg.super_tiebreak ? true : false,
    pistes: String(cfg.pistes || '').split(',').map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
    min_parelles: Math.max(2, Math.min(128, Number(cfg.min_parelles ?? 4) || 4)),
  };
  db.prepare('UPDATE competitions SET config = ? WHERE id = ?').run(JSON.stringify(net), competitionId);
  return net;
}

// --- Utilitats del sorteig ---
export function seguentPotenciaDeDos(n) {
  let p = 2;
  while (p < n) p *= 2;
  return Math.min(p, 128);
}

// Posicions (0-index) dels caps de sèrie 1..n en un quadre de mida `draw`.
// Algorisme "fold" estàndard: l'1 i el 2 només es poden trobar a la final,
// l'1-4 a semifinals, l'1-8 a quarts, etc.
export function posicionsCaps(draw, n) {
  let seq = [1];
  while (seq.length < draw) {
    const m = seq.length * 2 + 1;
    seq = seq.flatMap(x => [x, m - x]);
  }
  return seq.slice(0, n).map(p => p - 1);
}

const NOMS_RONDA = { 2: ['F'], 4: ['SF', 'F'], 8: ['QF', 'SF', 'F'], 16: ['R16', 'QF', 'SF', 'F'], 32: ['R32', 'R16', 'QF', 'SF', 'F'], 64: ['R64', 'R32', 'R16', 'QF', 'SF', 'F'], 128: ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'] };
export const ETIQUETA_RONDA = {
  R128: '1/128', R64: '1/64', R32: '1/32', R16: 'Vuitens', QF: 'Quarts', SF: 'Semifinals', F: 'Final',
};
export function rondesDe(draw) { return NOMS_RONDA[draw] || []; }

export function teQuadreGenerat(competitionId) {
  return db.prepare(`SELECT 1 FROM matches WHERE competition_id = ? AND stage = 'bracket' LIMIT 1`).get(competitionId) ? true : false;
}

export function teResultats(competitionId) {
  return db.prepare(`SELECT 1 FROM matches WHERE competition_id = ? AND stage = 'bracket' AND winner_id IS NOT NULL LIMIT 1`).get(competitionId) ? true : false;
}

// --- Generació del quadre ---
export function generaQuadre(competitionId, actorId = null) {
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(competitionId);
  if (!comp) throw new Error('Competició no trobada.');
  if (comp.format !== 'eliminatoria') throw new Error('Aquest generador només serveix per a eliminatòria.');
  if (!['draft', 'inscripcio'].includes(comp.status)) throw new Error('El quadre ja està generat.');
  if (teQuadreGenerat(competitionId)) throw new Error('El quadre ja està generat.');
  const cfg = llegirConfig(comp);
  const actius = participantsDe(competitionId, false);
  const n = actius.length;
  if (n < 2) throw new Error('Calen com a mínim 2 parelles per generar el quadre.');

  let draw = cfg.draw_size || seguentPotenciaDeDos(n);
  if (draw < seguentPotenciaDeDos(n)) throw new Error(`El quadre de ${draw} és massa petit per a ${n} parelles.`);
  const byes = draw - n;
  const avisaMinim = n < cfg.min_parelles;

  // Caps de sèrie: els N primers per número de seed
  const ambSeed = actius.filter(p => p.seed !== null && p.seed !== undefined).sort((a, b) => a.seed - b.seed);
  const numSeeds = Math.min(cfg.num_seeds, ambSeed.length, draw);
  const caps = ambSeed.slice(0, numSeeds);
  const capsIds = new Set(caps.map(p => p.id));
  const senseSeed = actius.filter(p => !capsIds.has(p.id));
  // Sorteig aleatori dels no-caps
  for (let i = senseSeed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [senseSeed[i], senseSeed[j]] = [senseSeed[j], senseSeed[i]];
  }

  // Col·locació: caps a posicions fixes, la resta omple en ordre.
  // Queden exactament `byes` forats: els assignem primer als caps i després a l'atzar.
  const pos = new Array(draw).fill(null); // entry_id o null
  const posCaps = posicionsCaps(draw, numSeeds);
  const setCaps = new Set(posCaps);
  caps.forEach((c, i) => { pos[posCaps[i]] = c.id; });
  let k = 0;
  for (let i = 0; i < draw && k < senseSeed.length; i++) {
    if (pos[i] === null) pos[i] = senseSeed[k++].id;
  }

  // donaByeA(p): el rival de p queda buit (bye per a p); si estava ocupat,
  // l'ocupant es mou a un forat segur (mai a un bye ja assignat).
  const foratsBye = new Set();
  let byesFets = 0;
  const donaByeA = (p) => {
    const rival = p ^ 1;
    if (pos[rival] === null) { foratsBye.add(rival); byesFets++; return; }
    for (let i = 0; i < draw; i++) {
      if (pos[i] === null && !foratsBye.has(i) && i !== rival) {
        pos[i] = pos[rival];
        pos[rival] = null;
        foratsBye.add(rival);
        byesFets++;
        return;
      }
    }
    throw new Error('No es pot assignar el bye.');
  };
  for (let i = 0; i < numSeeds && byesFets < byes; i++) donaByeA(posCaps[i]);
  // Resta de byes a l'atzar entre partits de primera ronda amb les dues parelles
  const slots = [...Array(draw / 2).keys()];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  for (const s of slots) {
    if (byesFets >= byes) break;
    const a = s * 2, b = s * 2 + 1;
    if (pos[a] === null || pos[b] === null) continue;
    if (setCaps.has(a) || setCaps.has(b)) continue;
    donaByeA(Math.random() < 0.5 ? a : b);
  }

  const rondes = rondesDe(draw);
  const ins = db.prepare(`INSERT INTO matches
    (competition_id, stage, bracket_round, bracket_slot, entry_a_id, entry_b_id, unplayed, winner_id, validation, notes)
    VALUES (?, 'bracket', ?, ?, ?, ?, ?, ?, 'auto', ?)`);
  const audit = db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail) VALUES (?, ?, 'generar_quadre', ?)`);

  // Un partit amb una sola parella és un bye NOMÉS si l'altra banda no arribarà mai
  // (forat de R1 o partit anterior buit). Si l'anterior encara s'ha de jugar, s'espera.
  transaccio(() => {
    const guanyadors = []; // guanyadors[r][s] = entry_id o null
    const buit = [];       // buit[r][s] = mai no tindrà parelles ni guanyador
    for (let r = 0; r < rondes.length; r++) {
      guanyadors[r] = []; buit[r] = [];
      const nPartits = draw / Math.pow(2, r + 1);
      for (let s = 0; s < nPartits; s++) {
        let a, b, mortA, mortB;
        if (r === 0) {
          a = pos[s * 2]; b = pos[s * 2 + 1];
          mortA = a === null; mortB = b === null;
        } else {
          a = guanyadors[r - 1][s * 2] || null;
          b = guanyadors[r - 1][s * 2 + 1] || null;
          mortA = buit[r - 1][s * 2]; mortB = buit[r - 1][s * 2 + 1];
        }
        const esBye = (a !== null && b === null && mortB) || (a === null && b !== null && mortA);
        const guanyador = esBye ? (a || b) : null;
        buit[r][s] = a === null && b === null && mortA && mortB;
        ins.run(competitionId, rondes[r], s, a, b, esBye ? 1 : 0, guanyador, esBye ? 'bye' : '');
        guanyadors[r][s] = guanyador;
      }
    }
    db.prepare(`UPDATE competitions SET status = 'en_joc' WHERE id = ?`).run(competitionId);
    audit.run(competitionId, actorId || null, `parelles=${n}; quadre=${draw}; byes=${byesFets}; caps=${numSeeds}`);
  });

  return { draw, byes: byesFets, parelles: n, caps: numSeeds, avisaMinim };
}

export function esborraQuadre(competitionId, actorId = null) {
  const comp = db.prepare('SELECT status FROM competitions WHERE id = ?').get(competitionId);
  if (!comp) throw new Error('Competició no trobada.');
  if (teResultats(competitionId)) throw new Error('No es pot esborrar: ja hi ha resultats registrats. Esborra\'ls primer.');
  transaccio(() => {
    db.prepare(`DELETE FROM matches WHERE competition_id = ? AND stage = 'bracket'`).run(competitionId);
    db.prepare(`UPDATE competitions SET status = 'inscripcio' WHERE id = ?`).run(competitionId);
    db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail) VALUES (?, ?, 'esborra_quadre', '')`)
      .run(competitionId, actorId || null);
  });
}

// --- Resultats ---
function guanyadorDeSets(d, calen = 2) {
  // al millor de 3 sets (calen=2); calen=1 per saber qui guanya un set concret
  let sa = 0, sb = 0;
  const sets = [[d.s1a, d.s1b], [d.s2a, d.s2b], [d.s3a, d.s3b]];
  for (const [a, b] of sets) {
    if (a === null || b === null || a === undefined || b === undefined) continue;
    if (a === b) throw new Error('Un set no pot acabar en empat.');
    if (a > 7 || b > 7 || a < 0 || b < 0) throw new Error('Jocs per set no vàlids.');
    const diff = Math.abs(a - b);
    const max = Math.max(a, b);
    if (!((max === 6 && diff >= 2) || max === 7)) throw new Error(`Set no vàlid: ${a}-${b}.`);
    if (a > b) sa++; else sb++;
  }
  if (sa >= calen || sb >= calen) return sa > sb ? 'a' : 'b';
  return null;
}

export function desaResultat(matchId, competitionId, dades, actorId = null) {
  const m = db.prepare(`SELECT * FROM matches WHERE id = ? AND competition_id = ? AND stage = 'bracket'`).get(matchId, competitionId);
  if (!m) throw new Error('Partit no trobat.');
  if (m.unplayed) throw new Error('Aquest partit és un bye: no cal resultat.');
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(competitionId);
  const cfg = llegirConfig(comp);
  const tipus = String(dades.tipus || 'marcador'); // marcador | wo | retirada | desqualificacio

  let winnerId = null, woId = null, upd = {};
  if (tipus === 'marcador') {
    const num = (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0 || x > 30) throw new Error('Marcador no vàlid.');
      return x;
    };
    const d = {
      s1a: num(dades.s1a), s1b: num(dades.s1b),
      s2a: num(dades.s2a), s2b: num(dades.s2b),
      s3a: num(dades.s3a), s3b: num(dades.s3b),
      stb_a: num(dades.stb_a), stb_b: num(dades.stb_b),
    };
    // Super tie-break: si està activat i van 1-1, el 3r es juga com a STB
    let g = guanyadorDeSets({ s1a: d.s1a, s1b: d.s1b, s2a: d.s2a, s2b: d.s2b, s3a: null, s3b: null });
    if (!g && cfg.super_tiebreak && d.stb_a !== null && d.stb_b !== null) {
      if (d.stb_a === d.stb_b) throw new Error('El super tie-break no pot acabar en empat.');
      if (Math.max(d.stb_a, d.stb_b) < 10 || Math.abs(d.stb_a - d.stb_b) < 2)
        throw new Error('Super tie-break no vàlid (mínim 10 amb 2 de diferència).');
      // cal que vagin 1-1 en sets
      const s1 = guanyadorDeSets({ s1a: d.s1a, s1b: d.s1b, s2a: null, s2b: null, s3a: null, s3b: null }, 1);
      const s2 = guanyadorDeSets({ s1a: d.s2a, s1b: d.s2b, s2a: null, s2b: null, s3a: null, s3b: null }, 1);
      if (!s1 || !s2 || s1 === s2) throw new Error('El super tie-break només val si van 1-1 en sets.');
      g = d.stb_a > d.stb_b ? 'a' : 'b';
      upd = { ...d, s3a: null, s3b: null };
    } else {
      if (!g) throw new Error('El marcador no decideix el partit.');
      upd = { ...d, stb_a: null, stb_b: null };
    }
    if (!m.entry_a_id || !m.entry_b_id) throw new Error('El partit encara no té les dues parelles.');
    winnerId = g === 'a' ? m.entry_a_id : m.entry_b_id;
  } else {
    // wo | retirada | desqualificacio: cal triar el guanyador
    const w = String(dades.guanyador || '');
    if (w !== 'a' && w !== 'b') throw new Error('Tria la parella guanyadora.');
    winnerId = w === 'a' ? m.entry_a_id : m.entry_b_id;
    if (!winnerId) throw new Error('El partit encara no té les dues parelles.');
    if (tipus === 'wo') woId = winnerId;
    upd = { s1a: null, s1b: null, s2a: null, s2b: null, s3a: null, s3b: null, stb_a: null, stb_b: null };
  }

  // El partit següent: si ja té guanyador, cal esborrar-lo primer
  const rondes = rondesDe(bracketDrawDe(competitionId));
  const idx = rondes.indexOf(m.bracket_round);
  let seguent = null;
  if (idx >= 0 && idx < rondes.length - 1) {
    seguent = db.prepare(`SELECT * FROM matches WHERE competition_id = ? AND stage = 'bracket'
      AND bracket_round = ? AND bracket_slot = ?`).get(competitionId, rondes[idx + 1], Math.floor(m.bracket_slot / 2));
    if (seguent && seguent.winner_id) {
      throw new Error('El partit següent ja té resultat. Esborra\'l primer per corregir aquest.');
    }
  }

  transaccio(() => {
    db.prepare(`UPDATE matches SET s1a = ?, s1b = ?, s2a = ?, s2b = ?, s3a = ?, s3b = ?,
      stb_a = ?, stb_b = ?, winner_id = ?, wo_winner_id = ?, notes = ?, submitted_at = datetime('now'), validation = 'auto'
      WHERE id = ?`).run(
      upd.s1a, upd.s1b, upd.s2a, upd.s2b, upd.s3a, upd.s3b, upd.stb_a, upd.stb_b,
      winnerId, woId, String(dades.notes || '').slice(0, 200), matchId);
    if (seguent) {
      const col = m.bracket_slot % 2 === 0 ? 'entry_a_id' : 'entry_b_id';
      // Si el guanyador canvia, neteja la posició anterior
      db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(winnerId, seguent.id);
    } else {
      // Era la final: campions!
      db.prepare(`UPDATE competitions SET status = 'finalitzada' WHERE id = ?`).run(competitionId);
    }
    db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail) VALUES (?, ?, 'resultat', ?)`)
      .run(competitionId, actorId || null, `partit=${matchId}; tipus=${tipus}; guanyador=${winnerId}`);
  });
  return { winnerId };
}

function bracketDrawDe(competitionId) {
  // En eliminatòria simple: partits totals = mida del quadre - 1
  const n = db.prepare(`SELECT COUNT(*) n FROM matches WHERE competition_id = ? AND stage = 'bracket'`).get(competitionId).n;
  return n > 0 ? n + 1 : 0;
}

export function esborraResultat(matchId, competitionId, actorId = null) {
  const m = db.prepare(`SELECT * FROM matches WHERE id = ? AND competition_id = ? AND stage = 'bracket'`).get(matchId, competitionId);
  if (!m) throw new Error('Partit no trobat.');
  if (!m.winner_id || m.unplayed) throw new Error('Aquest partit no té resultat per esborrar.');
  const rondes = rondesDe(bracketDrawDe(competitionId));
  const idx = rondes.indexOf(m.bracket_round);
  transaccio(() => {
    if (idx >= 0 && idx < rondes.length - 1) {
      const seguent = db.prepare(`SELECT * FROM matches WHERE competition_id = ? AND stage = 'bracket'
        AND bracket_round = ? AND bracket_slot = ?`).get(competitionId, rondes[idx + 1], Math.floor(m.bracket_slot / 2));
      if (seguent) {
        if (seguent.winner_id) throw new Error('El partit següent ja té resultat. Esborra\'l primer.');
        const col = m.bracket_slot % 2 === 0 ? 'entry_a_id' : 'entry_b_id';
        // Només neteja si la plaça l'ocupa el guanyador d'aquest partit
        const actual = db.prepare(`SELECT ${col} v FROM matches WHERE id = ?`).get(seguent.id).v;
        if (actual === m.winner_id) db.prepare(`UPDATE matches SET ${col} = NULL WHERE id = ?`).run(seguent.id);
      }
    } else {
      db.prepare(`UPDATE competitions SET status = 'en_joc' WHERE id = ?`).run(competitionId);
    }
    db.prepare(`UPDATE matches SET s1a = NULL, s1b = NULL, s2a = NULL, s2b = NULL, s3a = NULL, s3b = NULL,
      stb_a = NULL, stb_b = NULL, winner_id = NULL, wo_winner_id = NULL, notes = '', validation = 'none' WHERE id = ?`).run(matchId);
    db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail) VALUES (?, ?, 'esborra_resultat', ?)`)
      .run(competitionId, actorId || null, `partit=${matchId}`);
  });
}

// --- Programació ---
export function programaPartit(matchId, competitionId, { scheduled_at, pista }, actorId = null) {
  const m = db.prepare(`SELECT id FROM matches WHERE id = ? AND competition_id = ? AND stage = 'bracket'`).get(matchId, competitionId);
  if (!m) throw new Error('Partit no trobat.');
  const sa = String(scheduled_at || '').trim().slice(0, 16) || null;
  if (sa && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(sa)) throw new Error('Data/hora no vàlida.');
  db.prepare(`UPDATE matches SET scheduled_at = ?, pista = ? WHERE id = ?`)
    .run(sa, String(pista || '').trim().slice(0, 40) || null, matchId);
  db.prepare(`INSERT INTO competition_audit (competition_id, actor_id, action, detail) VALUES (?, ?, 'programa', ?)`)
    .run(competitionId, actorId || null, `partit=${matchId}; ${sa || '-'}; ${pista || '-'}`);
}

// --- Lectura del quadre per a les vistes ---
export function quadreDe(competitionId) {
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(competitionId);
  if (!comp) return null;
  const draw = bracketDrawDe(competitionId);
  const rondes = rondesDe(draw);
  const partits = db.prepare(`
    SELECT m.*,
      ea.player1_name AS a1, ea.player2_name AS a2, ea.seed AS seed_a,
      eb.player1_name AS b1, eb.player2_name AS b2, eb.seed AS seed_b,
      ea.status AS estat_a, eb.status AS estat_b
    FROM matches m
    LEFT JOIN competition_entries ea ON ea.id = m.entry_a_id
    LEFT JOIN competition_entries eb ON eb.id = m.entry_b_id
    WHERE m.competition_id = ? AND m.stage = 'bracket'
    ORDER BY m.bracket_slot ASC`).all(competitionId);
  const perRonda = rondes.map(r => ({
    clau: r,
    etiqueta: ETIQUETA_RONDA[r] || r,
    partits: partits.filter(p => p.bracket_round === r),
  }));
  const campio = partits.find(p => p.bracket_round === 'F' && p.winner_id);
  return { comp, cfg: llegirConfig(comp), draw, rondes: perRonda, campio, teQuadre: partits.length > 0 };
}
