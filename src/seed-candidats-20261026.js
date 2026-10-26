// Sembra idempotent del torneig candidat del dilluns 2026-10-26 triat per
// Mathius: Open Head – Barberà Pàdel Indoor (FCP). En estat 'pending' perquè
// l'admin el revisi i aprovi (o rebutgi) des d'Administració → Tornejos.
//
// Idempotent: si el torneig (per nom exacte) ja existeix, no es duplica.
// Es pot executar en cada arrencada sense efectes secundaris.
const TORNEJOS = [
  {
    nom: 'Open Head – Barberà Pàdel Indoor',
    club: 'Barberà Padel Indoor',
    inici: '2026-11-15',
    fi: '2026-11-22',
    preu: '',
    via: 'Inscripció a través de la Federació Catalana de Pàdel (fcpadel.cat)',
    url: 'https://fcpadel.cat/',
    tipus: 'federat',
    deadline: '2026-11-13T10:00',
    descripcio:
      'Prova del Circuit Open Head de la Federació Catalana de Pàdel. ' +
      'Seu: Barberà Padel Indoor (Barberà del Vallès).',
    categories: [['M', 'Absolut'], ['F', 'Absolut']],
  },
];

export function sembraCandidats20261026(db) {
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
