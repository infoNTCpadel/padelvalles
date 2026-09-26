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
