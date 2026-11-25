// Séances de course structurées, selon le terrain choisi (piste, nature, côtes, trail).
// Échauffement, récupérations et retour au calme se terminent par un appui sur « Lap ».
// Sortie : étapes lisibles + texte au format intervals.icu (synchronisé ensuite sur COROS / Garmin).

const p2 = n => String(n).padStart(2, '0');
const sec = t => { if (!t) return null; const m = String(t).match(/(\d+)[:'h](\d{1,2})/); return m ? +m[1] * 60 + +m[2] : null; };
const mmss = s => Math.floor(s / 60) + ':' + p2(Math.round(s % 60) % 60);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const TERRAINS = {
  qualite: [['piste', 'Piste'], ['nature', 'Nature / chemins'], ['cotes', 'Côtes'], ['trail', 'Trail']],
  facile: [['route', 'Route'], ['nature', 'Nature / chemins'], ['vallonne', 'Vallonné'], ['plat', 'Plat']],
};

/**
 * @param o { type: 'qualite'|'facile'|'long', terrain, min, refs: {seuil, vma, fcmax}, niveau, cote? }
 */
export function buildWorkout(o) {
  const refs = o.refs || {}, s = sec(refs.seuil), vma = +refs.vma || (s ? 3600 / s / 0.85 * 1 : null), fc = +refs.fcmax || null;
  const beg = /Débutant/.test(o.niveau || '');
  const hr = (a, b) => fc ? `${Math.round(fc * a)}-${Math.round(fc * b)} bpm` : `${Math.round(a * 100)}-${Math.round(b * 100)} % FC max`;
  const icuHr = (a, b) => `${Math.round(a * 100)}-${Math.round(b * 100)}% HR`;
  const pace = (lo, hi) => `${mmss(lo)}-${mmss(hi)}/km`;
  const wu = { label: 'Échauffement', kind: 'warmup', lap: true, hint: '15 min', cible: hr(.65, .75), icu: `- Press lap Échauffement 15m ${icuHr(.65, .75)} intensity=warmup` };
  const cd = { label: 'Retour au calme', kind: 'cooldown', lap: true, hint: '10 min', cible: hr(.6, .7), icu: `- Press lap Retour au calme 10m ${icuHr(.6, .7)} intensity=cooldown` };
  const body = Math.max(15, (o.min || 60) - 25);
  const rec = (hint, why) => ({ label: 'Récup', kind: 'recovery', lap: true, hint, cible: why || 'trot très lent', icu: `- Press lap Récup ${hint.replace(/[^0-9ms]/g, '') || '2m'} ${icuHr(.6, .72)} intensity=recovery` });
  let titre, n, rep, terrainNote;

  if (o.type !== 'qualite') {
    const easy = s ? pace(s + 55, s + 80) : null, min = o.min || 45;
    const st = { label: o.type === 'long' ? 'Sortie longue' : 'Footing', kind: 'interval', time: min * 60, cible: hr(.7, .8) + (easy ? ' · ~' + easy : ''), icu: `- ${o.type === 'long' ? 'Sortie longue' : 'Footing'} ${min}m ${icuHr(.7, .8)}` };
    return { titre: (o.type === 'long' ? 'Sortie longue' : 'Footing') + ' ' + min + ' min', steps: [st], icu: st.icu, note: 'Aisance respiratoire : tu dois pouvoir parler.' };
  }

  if (o.terrain === 'piste') {
    if (beg || !s) {
      const pv = vma ? 3600 / vma : null; n = clamp(Math.floor(body * 60 / ((pv ? pv * .4 : 100) + 100)), 6, 12);
      titre = `Piste : ${n} × 400 m`; rep = { label: '400 m', kind: 'interval', dist: 400, cible: pv ? pace(pv * .98, pv * 1.03) + ' (VMA)' : 'vite mais régulier', icu: `- Rapide 400mtr ${pv ? pace(pv * .98, pv * 1.03) + ' Pace' : '90-95% HR'} intensity=interval` };
      terrainNote = 'Un tour de piste au couloir 1 = 400 m. Récup : 200 m en trottinant, puis Lap.';
      return out(titre, [wu, { repeat: n, steps: [rep, rec('1m30s')] }, cd], terrainNote);
    }
    n = clamp(Math.floor(body * 60 / (s + 90)), 3, 8);
    titre = `Piste : ${n} × 1000 m au seuil`;
    rep = { label: '1000 m seuil', kind: 'interval', dist: 1000, cible: pace(s - 3, s + 5), icu: `- Seuil 1km ${pace(s - 3, s + 5)} Pace intensity=interval` };
    terrainNote = '2,5 tours de piste par répétition. Récup : 200 m trottinés, puis Lap.';
    return out(titre, [wu, { repeat: n, steps: [rep, rec('1m30s')] }, cd], terrainNote);
  }

  if (o.terrain === 'cotes') {
    n = clamp(Math.floor(body / 2.5), 6, 12);
    titre = `Côtes : ${n} × 45 s`;
    rep = { label: 'Montée 45 s', kind: 'interval', time: 45, cible: 'fort, ' + hr(.9, .95) + ', buste droit, petits pas', icu: `- Montée 45s ${icuHr(.9, .95)} intensity=interval` };
    terrainNote = o.cote ? `Côte repérée sur le parcours au km ${o.cote.km} : ${o.cote.long} m à ${o.cote.pente} % de moyenne. Récup : redescends en trottinant, puis Lap.` : 'Cherche une côte de 5 à 8 % (150-250 m). Récup : redescends en trottinant, puis Lap.';
    return out(titre, [wu, { repeat: n, steps: [rep, rec('1m30s', 'descente en trottinant')] }, cd], terrainNote);
  }

  if (o.terrain === 'trail') {
    n = clamp(Math.floor(body / 8), 2, 5);
    titre = `Trail : ${n} × 5 min au seuil (à la FC)`;
    rep = { label: '5 min seuil', kind: 'interval', time: 300, cible: hr(.86, .91) + ' (au cardio : l\'allure ne veut rien dire en trail)', icu: `- Seuil 5m ${icuHr(.86, .91)} intensity=interval` };
    terrainNote = 'Sur sentier vallonné : garde le même effort en montée comme en descente. Marche dans les montées trop raides.';
    return out(titre, [wu, { repeat: n, steps: [rep, rec('2m')] }, cd], terrainNote);
  }

  // nature : fractionné au temps
  n = clamp(Math.floor(body / 8), 2, 5);
  titre = `Nature : ${n} × 6 min au seuil`;
  rep = { label: '6 min seuil', kind: 'interval', time: 360, cible: s ? pace(s - 2, s + 8) + ' (ou ' + hr(.86, .91) + ')' : hr(.86, .91), icu: `- Seuil 6m ${s ? pace(s - 2, s + 8) + ' Pace' : icuHr(.86, .91)} intensity=interval` };
  terrainNote = 'Sur chemin roulant et plat de préférence (allées, bords de l\'eau). Récup : 2 min de trot, puis Lap.';
  return out(titre, [wu, { repeat: n, steps: [rep, rec('2m')] }, cd], terrainNote);
}

function out(titre, steps, note) {
  const icu = steps.map(s => s.repeat ? `\n${s.repeat}x\n${s.steps.map(x => x.icu).join('\n')}\n` : s.icu).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { titre, steps, icu, note };
}

/** Texte lisible des étapes (pour l'appli et pour recopier à la main dans COROS). */
export function stepsText(w) {
  const line = s => `${s.label} : ${s.lap ? 'jusqu\'à l\'appui sur Lap (~' + s.hint.replace(/^(\d+)m30s$/, '$1 min 30').replace(/^(\d+)m$/, '$1 min') + ')' : s.dist ? s.dist + ' m' : s.time >= 60 ? Math.round(s.time / 60) + ' min' : s.time + ' s'} · ${s.cible}`;
  return w.steps.map(s => s.repeat ? `${s.repeat} × [ ${s.steps.map(line).join(' ; ')} ]` : line(s)).join('\n');
}
