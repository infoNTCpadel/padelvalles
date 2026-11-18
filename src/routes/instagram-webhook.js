// Webhook d'Instagram: escolta comentaris amb la paraula clau GUIA i respon
// amb un DM privat amb l'enllaç de la guia gratuïta (lead magnet per a jugadors).
// Meta crida GET per verificar el webhook (hub.challenge) i POST amb cada
// esdeveniment (comentaris). Configuració al .env:
//   WEBHOOK_VERIFY_TOKEN: cadena que inventa l'admin i repeteix a Meta
//   META_APP_SECRET: secret de l'app de Meta; verifica la signatura
//     X-Hub-Signature-256 de cada petició (si no hi és, no es verifica)
//   IG_USER_ID / IG_ACCESS_TOKEN: vegeu src/lib/instagram-dm.js

import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { enviaRespostaPrivada, instagramDmConfigurat } from '../lib/instagram-dm.js';

const r = express.Router();

// El webhook rep JSON; capturem el cos cru per verificar la signatura.
r.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || '';
const APP_SECRET = process.env.META_APP_SECRET || '';
const IG_USER_ID = process.env.IG_USER_ID || '';

const PARAULA = 'guia';
const URL_GUIA = 'https://padelvalles.com/guia?utm_source=instagram&utm_medium=dm&utm_campaign=guia-jugadors&font=ig-dm';
const MISSATGE_DM = `Hola! 👋 Aquí tens la guia gratuïta «10 errors que et fan perdre partits»:\n${URL_GUIA}\n\nDeixa'ns el teu email i la descarregues al moment. Ens veiem a la pista! 🎾`;

// Verificació del webhook (Meta): GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
r.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

function signaturaValida(req) {
  if (!APP_SECRET) return true; // sense secret configurat: no es pot verificar
  const signatura = req.get('X-Hub-Signature-256') || '';
  const esperada = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || '').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatura), Buffer.from(esperada));
  } catch {
    return false;
  }
}

function conteParaula(text) {
  // Minúscules sense accents, paraula sencera: «GUIA», «guia», «Guía»...
  const net = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new RegExp(`\\b${PARAULA}\\b`).test(net);
}

async function processaComentari(valor) {
  const commentId = valor.id;
  const text = valor.text || '';
  const mediaId = valor.media_id || '';
  const autor = valor.from || {};
  if (!commentId || !conteParaula(text)) return;
  if (autor.id && IG_USER_ID && String(autor.id) === String(IG_USER_ID)) return; // els nostres comentaris, no
  const ja = db.prepare('SELECT 1 FROM ig_dm_sent WHERE comment_id = ?').get(commentId);
  if (ja) return; // Meta pot reenviar el webhook: no duplicar el DM
  if (!instagramDmConfigurat()) {
    console.error('[ig-webhook] comentari GUIA rebut però falta IG_ACCESS_TOKEN al .env');
    return;
  }
  const resultat = await enviaRespostaPrivada(commentId, MISSATGE_DM);
  if (resultat.ok) {
    db.prepare('INSERT INTO ig_dm_sent (comment_id, media_id, username, paraula) VALUES (?, ?, ?, ?)')
      .run(commentId, mediaId, autor.username || '', PARAULA);
    console.log(`[ig-webhook] DM enviat a @${autor.username || '?'} (comentari ${commentId})`);
  }
}

r.post('/', (req, res) => {
  if (!signaturaValida(req)) return res.sendStatus(401);
  // Meta espera un 200 ràpid: responem de seguida i processem després.
  res.sendStatus(200);
  (async () => {
    try {
      const entries = req.body?.entry || [];
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          if (change.field === 'comments' && change.value) {
            await processaComentari(change.value);
          }
        }
      }
    } catch (e) {
      console.error('[ig-webhook] error processant:', e.message);
    }
  })();
});

export default r;
