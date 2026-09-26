// Carrega clubs i tornejos des de data/seed.json
// Format:
// {
//   "clubs": [{"nom": "...", "municipi": "...", "comarca": "occidental|oriental",
//              "web": "", "adreca": "", "telefon": "", "descripcio": ""}],
//   "tornejos": [{"nom": "...", "club": "Nom exacte del club", "inici": "2026-10-17",
//                "fi": "2026-10-18", "preu": "20 € per persona", "inscripcio": "WhatsApp...",
//                "url": "https://...", "descripcio": "...",
//                "categories": [{"modalitat": "M", "nivell": "Intermig"}]}]
// }
import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';

const seedPath = path.join(process.cwd(), 'data', 'seed.json');
if (!fs.existsSync(seedPath)) {
  console.error('No existeix data/seed.json');
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const clubIds = {};
for (const c of seed.clubs || []) {
  const ex = db.prepare('SELECT id FROM clubs WHERE name = ? AND town = ?').get(c.nom, c.municipi);
  if (ex) { clubIds[c.nom] = ex.id; continue; }
  const info = db.prepare(`INSERT INTO clubs (name, town, comarca, address, website, phone, description, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    c.nom, c.municipi, c.comarca === 'oriental' ? 'oriental' : 'occidental',
    c.adreca || '', c.web || '', c.telefon || '', c.descripcio || '', c.verificat === 0 ? 0 : 1);
  clubIds[c.nom] = info.lastInsertRowid;
}
console.log(`Clubs: ${Object.keys(clubIds).length}`);

let nT = 0;
for (const t of seed.tornejos || []) {
  const clubId = clubIds[t.club];
  if (!clubId) { console.warn(`Club no trobat per al torneig "${t.nom}": ${t.club}`); continue; }
  const ex = db.prepare('SELECT id FROM tournaments WHERE name = ? AND club_id = ?').get(t.nom, clubId);
  if (ex) continue;
  const info = db.prepare(`INSERT INTO tournaments
    (club_id, name, starts_at, ends_at, price_text, registration_info, registration_url, description, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', datetime('now'))`).run(
    clubId, t.nom, t.inici, t.fi || t.inici, t.preu || '', t.inscripcio || '', t.url || '', t.descripcio || '');
  const ins = db.prepare('INSERT INTO tournament_categories (tournament_id, modality, level) VALUES (?, ?, ?)');
  for (const cat of t.categories || []) ins.run(info.lastInsertRowid, cat.modalitat, cat.nivell || '');
  nT++;
}
console.log(`Tornejos: ${nT}`);
