import fs from 'node:fs';
import path from 'node:path';
import { BRAND, MODALITATS, TIPUS_TORNEIG } from './brand.js';

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

const MESOS_CA = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];

function descomp(iso) {
  const [Y, M, D] = String(iso || '').split('-').map(Number);
  return { Y, M, D };
}

// "de setembre" / "d'octubre" (contracció davant de vocal)
function deMes(m) {
  const nom = MESOS_CA[m - 1] || '';
  return /^[aeiouà]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}

export function fmtDataCurta(iso) {
  const { Y, M, D } = descomp(iso);
  if (!Y || !M || !D) return String(iso || '');
  return `${D} ${deMes(M)} de ${Y}`;
}

// Rang abreujat: "del 7 al 13 de setembre de 2026",
// "del 28 de setembre al 4 d'octubre de 2026"
function fmtRang(inici, fi) {
  if (!fi || inici === fi) return fmtDataCurta(inici);
  const a = descomp(inici), b = descomp(fi);
  if (!a.Y || !b.Y) return fmtDataCurta(inici);
  if (a.Y === b.Y && a.M === b.M) return `del ${a.D} al ${b.D} ${deMes(a.M)} de ${a.Y}`;
  if (a.Y === b.Y) return `del ${a.D} ${deMes(a.M)} al ${b.D} ${deMes(b.M)} de ${a.Y}`;
  return `del ${fmtDataCurta(inici)} al ${fmtDataCurta(fi)}`;
}

// Parteix un valor en com a màxim 2 línies de ~40 caràcters perquè
// el text no surti mai del cartell
function liniesValor(text) {
  let t = String(text || '');
  if (t.length > 84) t = t.slice(0, 82).trimEnd() + '…';
  const linies = [];
  let lin = '';
  for (const w of t.split(' ')) {
    if ((lin + ' ' + w).trim().length > 40) { linies.push(lin.trim()); lin = w; }
    else lin += ' ' + w;
  }
  if (lin.trim()) linies.push(lin.trim());
  return linies.slice(0, 2);
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

  // Crida a l'acció segons on es fan les inscripcions
  const modePropi = torneig.registration_mode === 'padelvalles';
  const ctaText = modePropi ? "INSCRIU-T'HI A PADELVALLÈS" : 'INSCRIPCIONS AL WEB DEL CLUB';

  // Distintiu del tipus de torneig (federat / open)
  const tipusText = (TIPUS_TORNEIG[torneig.tipus] || TIPUS_TORNEIG.open).toUpperCase();
  const pillW = Math.round(tipusText.length * 15 + 48);

  const detalls = [
    ['DATES', dataText],
    ['CLUB', `${club?.name || ''}${club?.town ? ' · ' + club.town : ''}`],
    modalitats.length ? ['MODALITATS', modalitats.join(' · ')] : null,
    torneig.price_text ? ['PREU', torneig.price_text] : null,
  ].filter(Boolean);

  // Files amb alçada dinàmica: els valors llargs passen a 2 línies en comptes
  // de sortir-se del cartell
  let yDetall = 800;
  const detallsSVG = detalls.map(([etiqueta, valor]) => {
    const linies = liniesValor(valor);
    const y0 = yDetall;
    yDetall += 92 + (linies.length - 1) * 46;
    const valorsSVG = linies.map((l, i) =>
      `<text x="90" y="${y0 + 42 + i * 46}" font-family="Verdana, sans-serif" font-size="38" fill="${c.ink}">${esc(l)}</text>`
    ).join('\n  ');
    return `<text x="90" y="${y0}" font-family="Verdana, sans-serif" font-size="26" font-weight="bold" fill="${c.accent}" letter-spacing="4">${esc(etiqueta)}</text>\n  ${valorsSVG}`;
  }).join('\n  ');

  const ctaY = Math.min(yDetall + 28, 1130);

  // Motiu de pàdel amb la mateixa tonalitat de marca (marca d'aigua subtil):
  // silueta de pala amb els forats i pilota amb les costures
  const motiuPadel = `
  <g transform="translate(775,935) rotate(-18)" opacity="0.10">
    <ellipse cx="0" cy="-40" rx="115" ry="150" fill="none" stroke="${c.accent}" stroke-width="16"/>
    <rect x="-20" y="105" width="40" height="170" rx="20" fill="none" stroke="${c.accent}" stroke-width="16"/>
    <g fill="${c.accent}">
      <circle cx="-60" cy="-110" r="10"/><circle cx="0" cy="-110" r="10"/><circle cx="60" cy="-110" r="10"/>
      <circle cx="-60" cy="-50" r="10"/><circle cx="0" cy="-50" r="10"/><circle cx="60" cy="-50" r="10"/>
      <circle cx="-60" cy="10" r="10"/><circle cx="0" cy="10" r="10"/><circle cx="60" cy="10" r="10"/>
      <circle cx="-30" cy="60" r="10"/><circle cx="30" cy="60" r="10"/>
    </g>
  </g>
  <g transform="translate(155,1285)" opacity="0.10">
    <circle cx="0" cy="0" r="58" fill="none" stroke="${c.bg}" stroke-width="12"/>
    <path d="M -38 -44 Q -8 0 -38 44" fill="none" stroke="${c.bg}" stroke-width="10"/>
    <path d="M 38 -44 Q 8 0 38 44" fill="none" stroke="${c.bg}" stroke-width="10"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.paper}"/>
  <circle cx="980" cy="120" r="380" fill="${c.bg}" opacity="0.05"/>
  <circle cx="80" cy="1240" r="340" fill="${c.accent}" opacity="0.08"/>

  ${motiuPadel}

  ${marcaB64 ? `<image href="data:image/png;base64,${marcaB64}" x="70" y="60" width="180" height="180" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <text x="270" y="145" font-family="Verdana, sans-serif" font-size="52" font-weight="bold" fill="${c.bg}" letter-spacing="2">PadelVallès</text>
  <rect x="270" y="162" width="${pillW}" height="46" rx="23" fill="${c.bg}"/>
  <text x="${Math.round(270 + pillW / 2)}" y="193" text-anchor="middle" font-family="Verdana, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" letter-spacing="2">${esc(tipusText)}</text>
  ${logoClub}

  <text x="90" y="470" font-family="Verdana, sans-serif" font-size="80" font-weight="bold" fill="${c.bg}">
    ${wrapTitle(esc(torneig.name))}
  </text>

  <rect x="90" y="700" width="900" height="5" fill="${c.accent}"/>

  ${detallsSVG}

  <rect x="90" y="${ctaY}" width="900" height="104" rx="16" fill="${c.accent}"/>
  <text x="540" y="${ctaY + 66}" text-anchor="middle" font-family="Verdana, sans-serif" font-size="40" font-weight="bold" fill="#ffffff">${ctaText}</text>

  <text x="90" y="${ctaY + 150}" font-family="Verdana, sans-serif" font-size="28" font-weight="bold" fill="${c.bg}" letter-spacing="2">padelvalles.com</text>
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
