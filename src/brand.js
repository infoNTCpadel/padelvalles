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

// --- Tancament d'inscripcions amb data i hora ---
// El deadline es guarda com 'YYYY-MM-DD' (llegat: tanca a final de dia) o
// 'YYYY-MM-DDTHH:MM'. Les comparacions es fan en hora d'Europe/Madrid.
export function deadlineComparable(d) {
  if (!d) return '';
  const s = String(d).trim().slice(0, 16);
  return s.length === 10 ? s + 'T23:59' : s;
}

export function araMadrid() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function deadlineTancat(d) {
  const c = deadlineComparable(d);
  return !!c && araMadrid() > c;
}

const MESOS_CA_DL = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
export function fmtDeadline(d) {
  if (!d) return '';
  const s = String(d);
  const [data, hora] = s.split('T');
  const [Y, M, D] = (data || '').split('-').map(Number);
  if (!Y || !M || !D) return s;
  const mes = MESOS_CA_DL[M - 1] || '';
  const de = /^[aeiouà]/i.test(mes) ? `d'${mes}` : `de ${mes}`;
  let out = `${D} ${de} de ${Y}`;
  if (hora && hora.slice(0, 5) !== '23:59') out += ` a les ${hora.slice(0, 5)}`;
  return out;
}

export function estatTorneig(t) {
  const avui = new Date().toISOString().slice(0, 10);
  if (!t) return { clau: 'tancada', etiqueta: ESTATS_TORNEIG.tancada };
  if (t.ends_at && t.ends_at < avui) return { clau: 'finalitzat', etiqueta: ESTATS_TORNEIG.finalitzat };
  if (t.starts_at && t.starts_at <= avui) return { clau: 'enjoc', etiqueta: ESTATS_TORNEIG.enjoc };
  if (deadlineTancat(t.registration_deadline)) return { clau: 'tancada', etiqueta: ESTATS_TORNEIG.tancada };
  return { clau: 'oberta', etiqueta: ESTATS_TORNEIG.oberta };
}
