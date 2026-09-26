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

// Tipus de torneig: els clubs organitzen tornejos de diversos dies i poden
// ser federats, opens o pertànyer a un circuit no federat.
export const TIPUS_TORNEIG = {
  federat: 'Federat',
  open: 'Open',
  circuit: 'Circuit no federat',
};
