// Ajust puntual (2026-11-18): omple l'email de contacte d'Oha Padel (Polinyà),
// trobat a la seva web oficial (ohapadel.com/contacto). Cal Artigues no té
// email públic (només telèfon/WhatsApp/Instagram), així que no s'hi afegeix res.
//
// Només omple el camp si està buit; no sobreescriu mai un valor existent.
// Idempotent: es pot executar en cada arrencada sense efectes secundaris.
export function sembraEmailsClubs20261118(db) {
  db.prepare(`
    UPDATE clubs SET email = 'oha@ohapadel.com'
    WHERE name = 'Oha Padel'
      AND (email IS NULL OR email = '')
  `).run();
}
