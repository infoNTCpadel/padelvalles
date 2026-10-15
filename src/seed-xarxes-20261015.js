// Sembra idempotent de les xarxes socials dels 8 clubs amb tornejos (2026-10-15).
//
// Investigades i verificades una per una (web oficial del club o coincidència
// de municipi/contingut). Clubs sense xarxes verificables: NTB Nou Tenis
// Belulla, Pàdel Club La Llagosta i Club Junior 1917 (sense perfils
// localitzables o verificables).
//
// Només omple els camps buits: MAI sobreescriu un valor que el club o l'admin
// hagi posat manualment. Es pot executar en cada arrencada sense efectes
// secundaris.
const XARXES = [
  {
    club: 'VIP Padel Vilanova',
    instagram: 'https://www.instagram.com/vip_padel_vilanova/',
    facebook: 'https://www.facebook.com/vippadelvilanova',
    tiktok: 'https://www.tiktok.com/@vip.padel.vilanova',
  },
  {
    club: 'City Sports',
    instagram: 'https://www.instagram.com/citysports.cat/',
  },
  {
    club: 'Barberà Padel Indoor',
    instagram: 'https://www.instagram.com/barberapadelindoor/',
  },
  {
    club: 'Crack Sports Club',
    instagram: 'https://www.instagram.com/cracksportsclub/',
  },
  {
    club: 'Atlètic Terrassa Hockey Club',
    instagram: 'https://www.instagram.com/atleticterrassa/',
    facebook: 'https://www.facebook.com/AtleticTerrassaHockeyClub/',
    x: 'https://twitter.com/AtleticTerrassa',
    youtube: 'https://www.youtube.com/user/AtleticTerrassaTV',
  },
];

const COLS = ['instagram', 'facebook', 'x', 'tiktok', 'youtube'];

export function sembraXarxes20261015(db) {
  const troba = db.prepare('SELECT * FROM clubs WHERE name = ?');
  for (const x of XARXES) {
    const club = troba.get(x.club);
    if (!club) continue;
    const canvis = {};
    for (const col of COLS) {
      if (x[col] && !club[col]) canvis[col] = x[col];
    }
    const cols = Object.keys(canvis);
    if (!cols.length) continue;
    const set = cols.map(c => `${c} = ?`).join(', ');
    db.prepare(`UPDATE clubs SET ${set} WHERE id = ?`).run(...cols.map(c => canvis[c]), club.id);
  }
}
