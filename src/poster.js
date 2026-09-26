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

export function cartellSVG(torneig, club) {
  const c = BRAND.colors;
  const modalitats = [...new Set((torneig.categories || []).map(k => MODALITATS[k.modality] || k.modality))];
  const dataText = fmtRang(torneig.starts_at, torneig.ends_at);

  // Logo del club incrustat (si el club n'ha pujat un)
  let logoImg = '';
  const logoPath = club?.logo_path ? path.join(process.cwd(), 'data', club.logo_path) : null;
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      const buf = fs.readFileSync(logoPath);
      const ext = path.extname(logoPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const b64 = buf.toString('base64');
      logoImg = `<image href="data:${mime};base64,${b64}" x="840" y="80" width="160" height="160" preserveAspectRatio="xMidYMid meet"/>`;
    } catch { /* sense logo */ }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fons" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.bg2}"/>
      <stop offset="1" stop-color="${c.bg}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fons)"/>
  <circle cx="960" cy="200" r="420" fill="${c.accent}" opacity="0.07"/>
  <circle cx="120" cy="1150" r="360" fill="${c.accent}" opacity="0.06"/>

  <text x="80" y="150" font-family="Verdana, sans-serif" font-size="44" font-weight="bold" fill="${c.accent}" letter-spacing="6">PADELVALLÈS</text>
  <text x="80" y="195" font-family="Verdana, sans-serif" font-size="26" fill="${c.muted}">Torneig oficial del Vallès</text>
  ${logoImg}

  <text x="80" y="420" font-family="Verdana, sans-serif" font-size="84" font-weight="bold" fill="${c.text}">
    ${wrapTitle(esc(torneig.name))}
  </text>

  <rect x="80" y="700" width="920" height="3" fill="${c.accent}" opacity="0.6"/>

  <text x="80" y="790" font-family="Verdana, sans-serif" font-size="44" font-weight="bold" fill="${c.accent}">📅 ${esc(dataText)}</text>
  <text x="80" y="870" font-family="Verdana, sans-serif" font-size="40" fill="${c.text}">📍 ${esc(club?.name || '')} · ${esc(club?.town || '')}</text>
  ${modalitats.length ? `<text x="80" y="950" font-family="Verdana, sans-serif" font-size="40" fill="${c.text}">🏆 ${esc(modalitats.join(' · '))}</text>` : ''}
  ${torneig.price_text ? `<text x="80" y="1030" font-family="Verdana, sans-serif" font-size="40" fill="${c.text}">🎟️ ${esc(torneig.price_text)}</text>` : ''}

  <rect x="80" y="1100" width="920" height="110" rx="16" fill="${c.accent}"/>
  <text x="540" y="1172" text-anchor="middle" font-family="Verdana, sans-serif" font-size="42" font-weight="bold" fill="${c.bg}">INSCRIU-T'HI A PADELVALLÈS</text>

  <text x="80" y="1280" font-family="Verdana, sans-serif" font-size="28" fill="${c.muted}">padelvalles.com</text>
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
    `<tspan x="80" dy="${i === 0 ? 0 : 100}">${l}</tspan>`).join('');
}
