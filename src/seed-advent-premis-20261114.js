// Actualització dels premis del Calendari d'Advent (14-nov-2026, Mathius):
// dies 1-4 sense canvis; dia 12 = Joc de Cartes Tie Break Padel (amb enllaç
// de compra); dies 5-11 i 13-23 = pendents de confirmar; dia 24 = premi
// sorpresa (la pala encara no està confirmada).
//
// Idempotent i respectuós amb l'admin: cada UPDATE només s'aplica si el
// títol encara és el PROVISIONAL de la llavor inicial (db.js). Si Mathius
// ja ha editat un premi des de /admin/advent, el seu canvi es conserva i
// aquesta seed no el trepitja en arrencades posteriors.
const PENDENT = [
  'Premi pendent de confirmar. Aviat sabràs què s’amaga dins d’aquesta casella! 🎁',
  'Encara és un misteri... però prometem que valdrà la pena esperar. 🎁',
  'El premi d’aquest dia encara s’està cuinant. Torna aviat per descobrir-lo! 🎁',
  'Sorpresa pendent de confirmar. La paciència també juga... o gairebé! 😄',
];

// [dia, títol provisional que s'ha de substituir]
const PROVISIONALS = [
  [5, 'Bidó esportiu'],
  [6, 'Protector de pala'],
  [7, 'Bote de pelotas'],
  [8, 'Gorra PadelVallès'],
  [9, 'Tovallola de microfibra'],
  [10, 'Bote de pelotas'],
  [11, 'Buf de pádel'],
  [13, 'Bote de pelotas'],
  [14, 'Pack de 2 botes de pelotas'],
  [15, 'Mitjons tècnics'],
  [16, 'Canellera i grips'],
  [17, 'Bote de pelotas'],
  [18, 'Samarreta tècnica'],
  [19, 'Bote de pelotas'],
  [20, 'Tovallola i protector'],
  [21, 'Bote de pelotas premium'],
  [22, 'Pack d’accessoris'],
  [23, 'Bote de pelotas i bidó'],
];

export function actualitzaPremisAdvent20261114(db) {
  const upd = db.prepare(
    'UPDATE advent_days SET title = ?, description = ? WHERE day = ? AND title = ?');
  for (const [dia, provisional] of PROVISIONALS) {
    upd.run('Premi sorpresa', PENDENT[(dia - 5) % PENDENT.length], dia, provisional);
  }
  upd.run('Joc de Cartes Tie Break Padel',
    'PREMI ESPECIAL de meitat de calendari: el joc de cartes Tie Break Padel, per seguir jugant a pàdel fins i tot quan no hi ha pista! Estratègia, cops i molta picardia en una baralla. Si te’l vols comprar: https://link.amazon/B02XRQpn8',
    12, 'Motxilla de pádel');
  upd.run('Premi sorpresa',
    'El gran premi final del Calendari d’Advent, valorat en 180 €. De moment és un secret... però quan s’obri aquesta casella, ho sabràs! Molta sort! 🍀',
    24, 'Gran premi final');
}
