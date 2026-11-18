// Respostes privades d'Instagram (Private Replies API): envia un DM a qui ha
// comentat una paraula clau en un post/reel, sense que ens hagi escrit abans.
// Configuració al .env: IG_USER_ID, IG_ACCESS_TOKEN.
// Límit de Meta: una sola resposta privada per comentari, dins dels 7 dies
// posteriors al comentari. Si la persona respon al DM, s'obre una conversa
// normal (finestra de 24 h per respondre-li).

const IG_API_VERSION = 'v23.0';
const IG_USER_ID = process.env.IG_USER_ID || '';
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || '';

export function instagramDmConfigurat() {
  return Boolean(IG_USER_ID && IG_ACCESS_TOKEN);
}

export async function enviaRespostaPrivada(commentId, text) {
  if (!instagramDmConfigurat()) {
    console.error('[ig-dm] falta IG_USER_ID o IG_ACCESS_TOKEN al .env');
    return { ok: false, error: 'no-configurat' };
  }
  try {
    const r = await fetch(`https://graph.instagram.com/${IG_API_VERSION}/${IG_USER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
    });
    const dades = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[ig-dm] error enviant resposta privada:', r.status, JSON.stringify(dades));
      return { ok: false, error: `HTTP ${r.status}`, detall: dades };
    }
    return { ok: true, messageId: dades.message_id || null };
  } catch (e) {
    console.error('[ig-dm] error de connexió:', e.message);
    return { ok: false, error: 'connexio' };
  }
}
