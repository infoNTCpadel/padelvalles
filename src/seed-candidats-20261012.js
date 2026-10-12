// Sembra idempotent dels 2 tornejos candidats del dilluns 2026-10-12
// triats per Mathius (l'1 i el 3; el 2n, Torneig Social de Valldoreix,
// queda fora: cal verificar si és obert a no socis).
//
// Es creen els clubs que falten i els tornejos en estat 'pending' perquè
// l'admin els revisi i aprovi (o rebutgi) des d'Administració → Tornejos.
// La inscripció és externa: els clubs ho gestionen.
//
// Idempotent: si el club o el torneig (per nom exacte) ja existeixen, no es
// dupliquen. Es pot executar en cada arrencada sense efectes secundaris.
const CLUBS_NOUS = [
  { name: 'Crack Sports Club', town: 'Granollers', comarca: 'oriental', address: '' },
  {
    name: 'Atlètic Terrassa Hockey Club',
    town: 'Terrassa',
    comarca: 'occidental',
    address: 'Can Salas, Ctra. de Castellar 628, 08227 Terrassa',
  },
];

const TORNEJOS = [
  {
    nom: '11è Torneig de Pàdel',
    club: 'Crack Sports Club',
    inici: '2026-11-09',
    fi: '2026-11-15',
    preu: '35 € (1 categoria) / 50 € (2 categories)',
    via: 'Inscripció a l\u2019app Xporty (cerca «Crack Sports Club»), fins al 22 d\u2019octubre',
    url: 'https://www.instagram.com/p/DeO0h8WDh8o/',
    tipus: 'open',
    descripcio:
      'Torneig al Crack Sports Club de Granollers. Categories masculí, femení i mixt. ' +
      'Inclou 2 partits, boles noves, samarreta i aigua. Premis: pala Black Crown als guanyadors; ' +
      'cava o vi als campions de consolació.',
    categories: [['M', ''], ['F', ''], ['X', '']],
  },
  {
    nom: 'Open Head – Atlètic Terrassa Hockey Club',
    club: 'Atlètic Terrassa Hockey Club',
    inici: '2026-11-01',
    fi: '2026-11-08',
    preu: '',
    via: 'Inscripció a través de la Federació Catalana de Pàdel (fcpadel.cat). Límit: 30/10/2026 a les 10:00',
    url: 'https://fcpadel.cat/',
    tipus: 'federat',
    descripcio:
      'Prova del Circuit Open Head de la Federació Catalana de Pàdel. ' +
      'Seu: Atlètic Terrassa Hockey Club, Can Salas (Ctra. de Castellar 628, 08227 Terrassa).',
    categories: [['M', 'Absolut'], ['F', 'Absolut']],
  },
];

export function sembraCandidats20261012(db) {
  const trobaClub = db.prepare('SELECT id FROM clubs WHERE name = ?');
  const creaClub = db.prepare(
    'INSERT INTO clubs (name, town, comarca, address, verified) VALUES (?, ?, ?, ?, 1)'
  );
  const existeixTorneig = db.prepare('SELECT id FROM tournaments WHERE name = ?');
  const creaTorneig = db.prepare(
    `INSERT INTO tournaments
      (club_id, name, starts_at, ends_at, price_text, registration_info, registration_url,
       registration_mode, registration_deadline, unregister_hours, tipus, mostra_inscrits,
       description, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'externa', '', 48, ?, 1, ?, 'pending', NULL)`
  );
  const creaCategoria = db.prepare(
    'INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, NULL)'
  );

  for (const c of CLUBS_NOUS) {
    if (!trobaClub.get(c.name)) {
      creaClub.run(c.name, c.town, c.comarca, c.address);
    }
  }

  for (const t of TORNEJOS) {
    if (existeixTorneig.get(t.nom)) continue;
    const club = trobaClub.get(t.club);
    if (!club) continue; // sense club no es crea res
    const r = creaTorneig.run(
      club.id, t.nom, t.inici, t.fi, t.preu, t.via, t.url,
      t.tipus, t.descripcio
    );
    for (const [modalitat, nivell] of t.categories) {
      creaCategoria.run(r.lastInsertRowid, modalitat, nivell);
    }
  }
}
