// Limitador de freqüència simple en memòria: clau -> timestamps d'intents.
// Serveix per protegir l'enviament d'emails (registres, reenviaments) de l'abús.
const intents = new Map();

export function permet(clau, maxim, finestraMs) {
  const ara = Date.now();
  const recents = (intents.get(clau) || []).filter(t => ara - t < finestraMs);
  if (recents.length >= maxim) return false;
  recents.push(ara);
  intents.set(clau, recents);
  return true;
}

// Neteja periòdica perquè el mapa no creixi sense límit
setInterval(() => {
  const ara = Date.now();
  for (const [k, v] of intents) {
    const recents = v.filter(t => ara - t < 24 * 3600 * 1000);
    if (recents.length) intents.set(k, recents);
    else intents.delete(k);
  }
}, 3600 * 1000).unref();
