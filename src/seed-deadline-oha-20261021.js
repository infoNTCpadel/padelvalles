// Ajust puntual (2026-10-21): l'Open Head de la FCP a Oha Padel (Polinyà,
// 25/10–01/11) tanca inscripcions el 23/10/2026 a les 10:00, però el torneig
// es va crear des del formulari quan el camp «Tancament d'inscripcions»
// encara estava ocult per als tornejos externs.
//
// Només omple el camp si està buit; no sobreescriu mai un valor existent.
// Idempotent: es pot executar en cada arrencada sense efectes secundaris.
export function sembraDeadlineOha20261021(db) {
  db.prepare(`
    UPDATE tournaments SET registration_deadline = '2026-10-23T10:00'
    WHERE starts_at = '2026-10-25'
      AND (registration_deadline IS NULL OR registration_deadline = '' OR registration_deadline = '2026-10-23')
      AND club_id = (SELECT id FROM clubs WHERE name = 'Oha Padel')
  `).run();
}
