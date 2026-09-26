// Converteix els JSON d'investigació a data/seed.json (format de src/seed.js)
// Ús: node src/build-seed.js
import fs from 'node:fs';
import path from 'node:path';

const RN = path.join(process.cwd(), '..', 'research_notes');
const clubs = [];
const vistos = new Set();

function normWeb(w) {
  if (!w) return '';
  w = String(w).trim();
  if (!/^https?:\/\//i.test(w)) w = 'https://' + w;
  return w;
}

function afegeix(nom, municipi, comarca, web, adreca, verificat = true) {
  nom = String(nom || '').trim();
  municipi = String(municipi || '').trim();
  if (!nom || !municipi) return;
  const clau = (nom + '|' + municipi).toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, '');
  if (vistos.has(clau)) return;
  vistos.add(clau);
  clubs.push({ nom, municipi, comarca, web: normWeb(web), adreca: String(adreca || '').trim(), verificat: verificat ? 1 : 0 });
}

// Vallès Occidental (agrupat per municipi)
{
  const j = JSON.parse(fs.readFileSync(path.join(RN, 'clubs-valles-occidental-20260926.json'), 'utf8'));
  for (const m of j.municipis || []) {
    for (const c of m.clubs || []) afegeix(c.nom, m.municipi, 'occidental', c.web, c.adreça);
  }
}

// Vallès Oriental (llista plana)
{
  const j = JSON.parse(fs.readFileSync(path.join(RN, 'padel-clubs-valles-oriental-20260926.json'), 'utf8'));
  for (const c of j.clubs || []) afegeix(c.nom, c.municipi, 'oriental', c.web, c.adreça, c.verificat !== false);
}

// Tornejos propers (si l'agent ja ha lliurat el fitxer)
const tornejos = [];
{
  const p = path.join(RN, 'torneos-proximos-20260926.json');
  if (fs.existsSync(p)) {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const t of j.tornejos || j || []) {
      tornejos.push({
        nom: t.nom, club: t.club, inici: t.inici, fi: t.fi || t.inici,
        preu: t.preu || '', inscripcio: t.inscripcio || '', url: t.url || '',
        descripcio: t.descripcio || '', categories: t.categories || []
      });
    }
  }
}

const seed = { clubs, tornejos };
fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'data', 'seed.json'), JSON.stringify(seed, null, 2));
console.log(`seed.json: ${clubs.length} clubs, ${tornejos.length} tornejos`);
