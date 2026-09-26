// Enviament d'emails transaccionals via Brevo (https://www.brevo.com).
// Configuració al .env: BREVO_API_KEY, MAIL_FROM, APP_URL.
// Si BREVO_API_KEY no està definit, l'email s'escriu al log del servidor
// (mode desenvolupament): així l'app funciona igual amb o sense clau.

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'hola@padelvalles.com';
const APP_URL = (process.env.APP_URL || 'https://padelvalles.com').replace(/\/$/, '');

export function verificationUrl(token) {
  return `${APP_URL}/verifica/${token}`;
}

export async function sendVerificationEmail(email, nom, token) {
  const url = verificationUrl(token);
  if (!BREVO_API_KEY) {
    console.log(`[verificació] ${email}: ${url}`);
    return;
  }
  const htmlContent = `
    <p>Hola ${String(nom || '').replace(/</g, '&lt;')},</p>
    <p>Gràcies per registrar-te a <strong>PadelVallès</strong>. Fes clic a l'enllaç per verificar el teu compte:</p>
    <p><a href="${url}">${url}</a></p>
    <p>Si no has creat aquest compte, ignora aquest missatge.</p>`;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: MAIL_FROM, name: 'PadelVallès' },
        to: [{ email, name: nom || '' }],
        subject: 'Verifica el teu compte de PadelVallès',
        htmlContent,
      }),
    });
    if (!r.ok) console.error('[brevo] no s’ha pogut enviar:', r.status, await r.text());
  } catch (e) {
    console.error('[brevo] error de connexió:', e.message);
  }
}

// --- Fase 2: inscripcions ---

function esc(s) { return String(s || '').replace(/</g, '&lt;'); }

async function envia({ to, name, subject, tag, html }) {
  if (!BREVO_API_KEY) {
    console.log(`[${tag}] ${to}: ${subject}`);
    return;
  }
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: MAIL_FROM, name: 'PadelVallès' },
        to: [{ email: to, name: name || '' }],
        subject,
        htmlContent: html,
      }),
    });
    if (!r.ok) console.error('[brevo] no s’ha pogut enviar:', r.status, await r.text());
  } catch (e) {
    console.error('[brevo] error de connexió:', e.message);
  }
}

export function sendInvitacioParella(email, nom, quiConvid, torneigNom, categoria) {
  return envia({
    to: email, name: nom, tag: 'invitació',
    subject: `${quiConvid} et convida a jugar el torneig «${torneigNom}»`,
    html: `<p>Hola ${esc(nom)},</p>
      <p><strong>${esc(quiConvid)}</strong> t'ha convidat a formar parella amb ell/a per al torneig
      <strong>${esc(torneigNom)}</strong> (${esc(categoria)}) a PadelVallès.</p>
      <p>Entra a <a href="${APP_URL}/elmeucompte">El meu compte</a> per acceptar o rebutjar la invitació.</p>
      <p>Si no coneixes aquesta persona, rebutja la invitació i ignora aquest missatge.</p>`,
  });
}

export function sendInvitacioAcceptada(email, nom, quiAccepta, torneigNom, categoria) {
  return envia({
    to: email, name: nom, tag: 'invitació acceptada',
    subject: `La teva parella ha acceptat: «${torneigNom}»`,
    html: `<p>Hola ${esc(nom)},</p>
      <p><strong>${esc(quiAccepta)}</strong> ha acceptat la teva invitació per al torneig
      <strong>${esc(torneigNom)}</strong> (${esc(categoria)}).</p>
      <p>Pots veure la teva inscripció a <a href="${APP_URL}/elmeucompte">El meu compte</a>.</p>`,
  });
}

export function sendInscripcioConfirmada(email, nom, torneigNom, categoria, enEspera) {
  return envia({
    to: email, name: nom, tag: 'inscripció',
    subject: enEspera ? `En llista d'espera: «${torneigNom}»` : `Inscripció confirmada: «${torneigNom}»`,
    html: enEspera
      ? `<p>Hola ${esc(nom)},</p>
        <p>La vostra parella ja està apuntada al torneig <strong>${esc(torneigNom)}</strong> (${esc(categoria)}),
        però de moment esteu en <strong>llista d'espera</strong>: la categoria és plena.
        T'avisarem si s'allibera alguna plaça.</p>`
      : `<p>Hola ${esc(nom)},</p>
        <p>La vostra parella ja està <strong>inscrita</strong> al torneig <strong>${esc(torneigNom)}</strong>
        (${esc(categoria)}). Ens veiem a la pista!</p>
        <p>Recorda que el pagament es fa directament al club organitzador.</p>`,
  });
}

export function sendPromocioEspera(email, nom, torneigNom, categoria) {
  return envia({
    to: email, name: nom, tag: 'promoció',
    subject: `Plaça alliberada: «${torneigNom}»`,
    html: `<p>Hola ${esc(nom)},</p>
      <p>Bona notícia: s'ha alliberat una plaça i la vostra parella passa de la llista d'espera a
      <strong>inscrita</strong> al torneig <strong>${esc(torneigNom)}</strong> (${esc(categoria)}).</p>
      <p>Recorda que el pagament es fa directament al club organitzador.</p>`,
  });
}

export function sendInvitacioRebutjada(email, nom, quiRebutja, torneigNom) {
  return envia({
    to: email, name: nom, tag: 'invitació rebutjada',
    subject: `Invitació rebutjada: «${torneigNom}»`,
    html: `<p>Hola ${esc(nom)},</p>
      <p><strong>${esc(quiRebutja)}</strong> ha rebutjat la teva invitació per fer parella al torneig
      <strong>${esc(torneigNom)}</strong>.</p>
      <p>Si busques parella, pots publicar un anunci a la fitxa del torneig, a l'apartat «Busques parella?».</p>`,
  });
}
