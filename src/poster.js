import fs from 'node:fs';
import path from 'node:path';
import { BRAND, MODALITATS } from './brand.js';

// Genera el cartell oficial del torneig com a SVG (1080x1350, format retrat
// per compartir a Instagram/WhatsApp). Els clubs no pugen cartells: la
// plataforma el genera sempre amb la identitat de marca.
const W = 1080, H = 1350;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtData(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  } catch { return iso; }
}

function fmtRang(inici, fi) {
  const a = fmtData(inici), b = fmtData(fi);
  return a === b ? a : `Del ${a} al ${b}`;
}

// Logo oficial de PadelVallès incrustat (es carrega un cop)
let marcaB64 = '';
try {
  marcaB64 = fs.readFileSync(path.join(process.cwd(), 'public', 'logo-400.png')).toString('base64');
} catch { /* sense logo de marca */ }

function imatgeB64(rutaAbsoluta, x, y, mida) {
  try {
    const buf = fs.readFileSync(rutaAbsoluta);
    const ext = path.extname(rutaAbsoluta).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return `<image href="data:${mime};base64,${buf.toString('base64')}" x="${x}" y="${y}" width="${mida}" height="${mida}" preserveAspectRatio="xMidYMid meet"/>`;
  } catch { return ''; }
}

export function cartellSVG(torneig, club) {
  const c = BRAND.colors;
  const modalitats = [...new Set((torneig.categories || []).map(k => MODALITATS[k.modality] || k.modality))];
  const dataText = fmtRang(torneig.starts_at, torneig.ends_at);

  const logoClubPath = club?.logo_path ? path.join(process.cwd(), 'data', club.logo_path) : null;
  const logoClub = logoClubPath && fs.existsSync(logoClubPath) ? imatgeB64(logoClubPath, 830, 70, 170) : '';

  // Crida a l'acció segons on es fan les inscripcions (fase 1: web del club)
  const modePropi = torneig.registration_mode === 'padelvalles';
  const ctaText = modePropi ? "INSCRIU-T'HI A PADELVALLÈS" : 'INSCRIPCIONS AL WEB DEL CLUB';

  const detalls = [
    ['DATES', dataText],
    ['CLUB', `${club?.name || ''}${club?.town ? ' · ' + club.town : ''}`],
    modalitats.length ? ['MODALITATS', modalitats.join(' · ')] : null,
    torneig.price_text ? ['PREU', torneig.price_text] : null,
  ].filter(Boolean).map(([e, v]) => [e, v.length > 52 ? v.slice(0, 50) + '…' : v]);

  const detallsSVG = detalls.map(([etiqueta, valor], i) => {
    const y = 800 + i * 92;
    return `<text x="90" y="${y}" font-family="Verdana, sans-serif" font-size="26" font-weight="bold" fill="${c.accent}" letter-spacing="4">${esc(etiqueta)}</text>
  <text x="90" y="${y + 42}" font-family="Verdana, sans-serif" font-size="38" fill="${c.ink}">${esc(valor)}</text>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.paper}"/>
  <circle cx="980" cy="120" r="380" fill="${c.bg}" opacity="0.05"/>
  <circle cx="80" cy="1240" r="340" fill="${c.accent}" opacity="0.08"/>

  ${marcaB64 ? `<image href="data:image/png;base64,${marcaB64}" x="70" y="60" width="180" height="180" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <text x="270" y="145" font-family="Verdana, sans-serif" font-size="52" font-weight="bold" fill="${c.bg}" letter-spacing="2">PadelVallès</text>
  <text x="270" y="190" font-family="Verdana, sans-serif" font-size="26" fill="${c.ink}" opacity="0.7">Torneig oficial del Vallès</text>
  ${logoClub}

  <text x="90" y="470" font-family="Verdana, sans-serif" font-size="80" font-weight="bold" fill="${c.bg}">
    ${wrapTitle(esc(torneig.name))}
  </text>

  <rect x="90" y="700" width="900" height="5" fill="${c.accent}"/>

  ${detallsSVG}

  <rect x="90" y="1140" width="900" height="104" rx="16" fill="${c.accent}"/>
  <text x="540" y="1206" text-anchor="middle" font-family="Verdana, sans-serif" font-size="40" font-weight="bold" fill="#ffffff">${ctaText}</text>

  <text x="90" y="1300" font-family="Verdana, sans-serif" font-size="28" font-weight="bold" fill="${c.bg}" letter-spacing="2">padelvalles.com</text>
</svg>`;
}

// Parteix el títol en línies de com a màxim ~22 caràcters per a <text> multilínia
function wrapTitle(title) {
  const words = title.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 22) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 3).map((l, i) =>
    `<tspan x="90" dy="${i === 0 ? 0 : 96}">${l}</tspan>`).join('');
}
