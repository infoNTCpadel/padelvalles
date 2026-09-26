// Identitat de marca de la plataforma. Canvia els colors aquí i es propaguen
// a tota la web i als cartells generats automàticament.
//
// Paleta oficial (briefing de rebranding 2026-09-26):
//   granate   #7A2036  color principal de marca
//   terracota #E8703A  accent (CTAs, destacar)
//   arena     #F7EFE3  neutre clar (fons)
//   grafito   #2B2B29  neutre fosc (text)
export const BRAND = {
  name: 'PadelVallès',
  tagline: 'Tots els tornejos del Vallès Occidental i Oriental',
  colors: {
    bg: '#7A2036',       // granate corporatiu
    bg2: '#5E1728',      // granate més fosc (degradats)
    accent: '#E8703A',   // terracota (accents, CTAs)
    text: '#FFFFFF',
    muted: '#F7EFE3',    // arena (textos secundaris sobre granate)
    card: '#FFFFFF',
    ink: '#2B2B29',      // grafito (text sobre fons clar)
    paper: '#F7EFE3',    // arena (fons general)
    vora: '#E7DCC8'      // vora càlida per a targetes
  }
};

export const COMARQUES = {
  occidental: 'Vallès Occidental',
  oriental: 'Vallès Oriental'
};

export const MODALITATS = {
  M: 'Masculí',
  F: 'Femení',
  X: 'Mixte'
};

// Tipus de torneig: només Federat o Open.
export const TIPUS_TORNEIG = {
  federat: 'Federat',
  open: 'Open',
};

// Nivells de jugador (escala 0 – 5,6)
export const NIVELLS = [
  { id: 'iniciacio', nom: 'Iniciació', rang: '0 – 0,999', descripcio: 'Sense experiència o molt poca en esports de raqueta.' },
  { id: 'principiant', nom: 'Principiant', rang: '1 – 1,499', descripcio: 'Encara aprenent les bases.' },
  { id: 'intermedi-iniciacio', nom: "Intermedi d'iniciació", rang: '1,5 – 2,4', descripcio: 'Familiaritzant-se amb el joc.' },
  { id: 'intermedi', nom: 'Intermedi', rang: '2,5 – 3,4', descripcio: 'Habilitats desenvolupades i tàctica bàsica.' },
  { id: 'intermedi-alt', nom: 'Intermedi alt', rang: '3,5 – 4,4', descripcio: 'Més seguretat i millors estratègies.' },
  { id: 'intermedi-avancat', nom: 'Intermedi avançat', rang: '4,5 – 5,4', descripcio: 'Alterna atac i defensa amb criteri.' },
  { id: 'competicio', nom: 'Competició', rang: '5,4 – 5,6', descripcio: 'Nivell professional.' },
];

export function nomNivell(id) {
  const n = NIVELLS.find(n => n.id === id);
  return n ? `${n.nom} (${n.rang})` : '';
}

// Estat del torneig segons les dates (semàfor públic)
export const ESTATS_TORNEIG = {
  oberta: 'Inscripció oberta',
  tancada: 'Inscripció tancada',
  enjoc: 'En joc',
  finalitzat: 'Finalitzat',
};

export function estatTorneig(t) {
  const avui = new Date().toISOString().slice(0, 10);
  if (!t) return { clau: 'tancada', etiqueta: ESTATS_TORNEIG.tancada };
  if (t.ends_at && t.ends_at < avui) return { clau: 'finalitzat', etiqueta: ESTATS_TORNEIG.finalitzat };
  if (t.starts_at && t.starts_at <= avui) return { clau: 'enjoc', etiqueta: ESTATS_TORNEIG.enjoc };
  if (t.registration_deadline && avui > t.registration_deadline) return { clau: 'tancada', etiqueta: ESTATS_TORNEIG.tancada };
  return { clau: 'oberta', etiqueta: ESTATS_TORNEIG.oberta };
}
