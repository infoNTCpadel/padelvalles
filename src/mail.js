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

export function resetUrl(token) {
  return `${APP_URL}/restableix/${token}`;
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

// --- Llista de Brevo: alta automàtica dels usuaris que ho han consentit ---
// La llista es busca pel nom ('padelvalles'); es pot fixar l'ID amb BREVO_LIST_ID.
let llistaIdCache = null;
async function idLlistaBrevo() {
  if (process.env.BREVO_LIST_ID) return Number(process.env.BREVO_LIST_ID);
  if (llistaIdCache) return llistaIdCache;
  const r = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50', {
    headers: { 'api-key': BREVO_API_KEY, accept: 'application/json' },
  });
  if (!r.ok) throw new Error('llistes: HTTP ' + r.status);
  const dades = await r.json();
  const llista = (dades.lists || []).find(l => String(l.name || '').toLowerCase() === 'padelvalles');
  if (!llista) throw new Error('llista "padelvalles" no trobada a Brevo');
  llistaIdCache = llista.id;
  return llista.id;
}

export async function afegirALlistaBrevo(email, nom) {
  if (!BREVO_API_KEY) { console.log(`[brevo] sense clau: no s'afegeix ${email} a la llista`); return; }
  try {
    const listId = await idLlistaBrevo();
    const r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email,
        attributes: { NOMBRE: nom || '' },
        listIds: [listId],
        updateEnabled: true,
      }),
    });
    if (!r.ok) console.error('[brevo] no s’ha pogut afegir a la llista:', r.status, await r.text());
    else console.log(`[brevo] ${email} afegit a la llista padelvalles`);
  } catch (e) {
    console.error('[brevo] error afegint a la llista:', e.message);
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

export function sendMonitorAutoritzat(email, nom, clubNom) {
  return envia({
    to: email, name: nom, tag: 'monitor autoritzat',
    subject: `El club «${clubNom}» t'ha autoritzat com a monitor`,
    html: `<p>Hola ${esc(nom)},</p>
      <p>El club <strong>${esc(clubNom)}</strong> t'ha autoritzat com a <strong>monitor</strong> a PadelVallès.</p>
      <p>A partir d'ara, quan entris al <a href="${APP_URL}/club/panel">panell del club</a> veuràs els seus tornejos
      i podràs gestionar-ne els inscrits (altes i baixes).</p>
      <p>Si no saps de què va això, contacta amb el club: potser l'email s'ha escrit malament.</p>`,
  });
}

export function sendPasswordReset(email, nom, token) {
  const url = resetUrl(token);
  return envia({
    to: email, name: nom, tag: 'restabliment',
    subject: 'Restableix la teva contrasenya de PadelVallès',
    html: `<p>Hola ${esc(nom)},</p>
      <p>Has demanat restablir la teva contrasenya de <strong>PadelVallès</strong>. Fes clic a l'enllaç (caduca en 1 hora):</p>
      <p><a href="${url}">${url}</a></p>
      <p>Si no l'has demanat tu, ignora aquest missatge.</p>`,
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

export function sendClaimResolta(email, nom, clubNom, aprovada) {
  return envia({
    to: email, name: nom, tag: 'reclamació club',
    subject: aprovada ? `Ja ets gestor de «${clubNom}» a PadelVallès` : `Sol·licitud per a «${clubNom}» no aprovada`,
    html: aprovada
      ? `<p>Hola ${esc(nom)},</p>
        <p>La teva sol·licitud per gestionar el club <strong>${esc(clubNom)}</strong> ha estat <strong>aprovada</strong>.</p>
        <p>Ja pots entrar al <a href="${APP_URL}/club/panel">panell del club</a> i publicar-hi els vostres tornejos.</p>`
      : `<p>Hola ${esc(nom)},</p>
        <p>La teva sol·licitud per gestionar el club <strong>${esc(clubNom)}</strong> no ha estat aprovada.</p>
        <p>Si creus que és un error, contacta amb nosaltres responent aquest correu.</p>`,
  });
}

export function sendResumDiariClub(email, nom, clubNom, linies) {
  const items = linies.map(l => `<li>${l}</li>`).join('');
  return envia({
    to: email, name: nom, tag: 'resum diari',
    subject: `Resum d'inscripcions: ${clubNom}`,
    html: `<p>Hola ${esc(nom)},</p>
      <p>Moviments d'inscripcions de les últimes 24 hores a <strong>${esc(clubNom)}</strong>:</p>
      <ul>${items}</ul>
      <p>Pots veure el detall al <a href="${APP_URL}/club/panel">panell del club</a>.</p>`,
  });
}

export function sendRecordatoriTancament(email, nom, torneigNom, torneigId, dataLimit) {
  return envia({
    to: email, name: nom, tag: 'recordatori tancament',
    subject: `Últims dies per apuntar-te a «${torneigNom}»`,
    html: `<p>Hola ${esc(nom)},</p>
      <p>Ens vas marcar que t'interessava el torneig <strong>${esc(torneigNom)}</strong>.</p>
      <p>Les inscripcions tanquen el <strong>${esc(dataLimit)}</strong>: si vols jugar-hi, apunta-t'hi abans que sigui tard.</p>
      <p><a href="${APP_URL}/torneig/${torneigId}">Veure el torneig i inscriure'm</a></p>`,
  });
}

export function sendParellaAfegidaClub(email, nom, torneigNom, categoria, enEspera) {
  return envia({
    to: email, name: nom, tag: 'alta manual',
    subject: enEspera ? `En llista d'espera: «${torneigNom}»` : `Inscripció confirmada: «${torneigNom}»`,
    html: `<p>Hola ${esc(nom)},</p>
      <p>El club organitzador t'ha inscrit al torneig <strong>${esc(torneigNom)}</strong> (${esc(categoria)}).
      ${enEspera ? 'De moment esteu en <strong>llista d\u2019espera</strong>: t\u2019avisarem si s\u2019allibera alguna plaça.'
        : 'La vostra inscripció ja està <strong>confirmada</strong>.'}</p>
      <p>Recorda que el pagament es fa directament al club organitzador.</p>
      <p>Pots veure la teva inscripció a <a href="${APP_URL}/elmeucompte">El meu compte</a>.</p>`,
  });
}
