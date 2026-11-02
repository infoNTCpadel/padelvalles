// Sembra idempotent del torneig candidat del dilluns 2026-11-02:
// Torneig Pàdel City Sports Club (L'Ametlla del Vallès, 7–8 de novembre).
//
// Font: cartell publicat per @citysports.cat a Instagram el 2026-10-24.
// En estat 'pending' perquè l'admin el revisi i aprovi (o rebutgi) des
// d'Administració → Tornejos. La inscripció és externa: la gestiona el club.
//
// Idempotent: si el torneig (per nom exacte) ja existeix, no es duplica.
// Es pot executar en cada arrencada sense efectes secundaris.
const TORNEJOS = [
  {
    nom: 'Torneig Pàdel City Sports Club',
    club: 'City Sports',
    inici: '2026-11-07',
    fi: '2026-11-08',
    preu: '10 € socis / 12 € no socis (per persona)',
    via: 'Inscripció mitjançant el formulari del club (Instagram @citysports.cat)',
    url: 'https://www.instagram.com/p/De4RzDpI5AO/',
    tipus: 'open',
    deadline: '',
    descripcio:
      'Torneig de cap de setmana al City Sports de l\u2019Ametlla del Vallès: ' +
      'dissabte 7 de novembre fase de grups (9h–20h), diumenge 8 eliminatòries ' +
      'i finals (9h–14h). Categories masculí, femení i mixt, nivells B+, B i C. ' +
      'Trofeus per a campions i finalistes.',
    categories: [['M', ''], ['F', ''], ['X', '']],
  },
];

export function sembraCandidats20261102(db) {
  const trobaClub = db.prepare('SELECT id FROM clubs WHERE name = ?');
  const existeixTorneig = db.prepare('SELECT id FROM tournaments WHERE name = ?');
  const creaTorneig = db.prepare(
    `INSERT INTO tournaments
      (club_id, name, starts_at, ends_at, price_text, registration_info, registration_url,
       registration_mode, registration_deadline, unregister_hours, tipus, mostra_inscrits,
       description, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'externa', ?, 48, ?, 1, ?, 'pending', NULL)`
  );
  const creaCategoria = db.prepare(
    'INSERT INTO tournament_categories (tournament_id, modality, level, max_pairs) VALUES (?, ?, ?, NULL)'
  );

  for (const t of TORNEJOS) {
    if (existeixTorneig.get(t.nom)) continue;
    const club = trobaClub.get(t.club);
    if (!club) continue; // sense club no es crea res
    const r = creaTorneig.run(
      club.id, t.nom, t.inici, t.fi, t.preu, t.via, t.url,
      t.deadline, t.tipus, t.descripcio
    );
    for (const [modalitat, nivell] of t.categories) {
      creaCategoria.run(r.lastInsertRowid, modalitat, nivell);
    }
  }
}
