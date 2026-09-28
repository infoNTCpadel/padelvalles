// Sembra idempotent dels 4 tornejos candidats del dilluns 2026-09-28.
//
// Es crea el club que falta (NTB Nou Tenis Belulla) i els tornejos en estat
// 'pending' perquè l'admin els revisi i aprovi (o rebutgi) des d'
// Administració → Tornejos. La inscripció és externa: els clubs ho gestionen.
//
// Idempotent: si el club o el torneig (per nom exacte) ja existeixen, no es
// dupliquen. Es pot executar en cada arrencada sense efectes secundaris.
const CLUB_NOU = {
  name: 'NTB Nou Tenis Belulla',
  town: 'Canovelles',
  comarca: 'oriental',
  address: 'Carrer Rupit, 17, 08420 Canovelles',
};

const TORNEJOS = [
  {
    nom: 'Campionat de Catalunya Absolut Open Plasticband',
    club: 'Club Junior 1917',
    inici: '2026-10-11',
    fi: '2026-10-18',
    preu: '',
    via: 'Inscripció a través de la Federació Catalana de Pàdel',
    url: 'https://www.fcpadel.cat',
    tipus: 'federat',
    descripcio: "Campionat de Catalunya federat. Terminis d'inscripció al cartell oficial.",
    categories: [['M', 'Absolut'], ['F', 'Absolut']],
  },
  {
    nom: 'Torneig de Pàdel COTA 360 PROJECT',
    club: 'City Sports',
    inici: '2026-10-17',
    fi: '2026-10-18',
    preu: '18 € socis / 22 € no socis',
    via: 'Instagram @citysports.cat',
    url: 'https://www.instagram.com/citysports.cat',
    tipus: 'open',
    descripcio:
      "Fase de grups el dissabte i eliminatòries i finals el diumenge. Inclou dinar per a tots els participants. " +
      "Welcome pack, photocall, repte X3, millor punt en vídeo, MVP per votació popular, sorteig digital i premi a l'esforç.",
    categories: [['M', 'B+, B i C'], ['F', 'B+, B i C'], ['X', 'B+, B i C']],
  },
  {
    nom: 'Torneig Solidari Memorial Oriol Barulls',
    club: 'Barberà Padel Indoor',
    inici: '2026-10-03',
    fi: '2026-10-03',
    preu: '20 € per persona',
    via: 'WhatsApp +34 608 98 90 23',
    url: '',
    tipus: 'open',
    descripcio:
      "Torneig solidari d'un dia (10:00 a 15:00). Recaptació per al Vall d'Hebron Barcelona Hospital Campus i " +
      "l'Associació 8000 Estels (recerca del càncer infantil). Sorteig.",
    categories: [['M', '1-3'], ['F', '1-2']],
  },
  {
    nom: 'Torneig Tombola Events (2a edició)',
    club: 'NTB Nou Tenis Belulla',
    inici: '2026-10-24',
    fi: '2026-10-25',
    preu: '',
    via: 'Instagram @tombolaevents',
    url: 'https://www.instagram.com/tombolaevents',
    tipus: 'open',
    descripcio: 'Organitzat per Tombola Events.',
    categories: [['M', ''], ['F', ''], ['X', '']],
  },
];

export function sembraCandidats20260928(db) {
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

  // Club nou (només si no existeix)
  if (!trobaClub.get(CLUB_NOU.name)) {
    creaClub.run(CLUB_NOU.name, CLUB_NOU.town, CLUB_NOU.comarca, CLUB_NOU.address);
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
