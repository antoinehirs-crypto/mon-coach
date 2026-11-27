// Moteur du coach : séance du jour en 3 niveaux, séance sur demande, modifications.
// Les règles (propose.js + sessions.js) donnent toujours une réponse, même hors ligne.
// Si une IA est configurée côté serveur (fonction coach-ai), elle rédige les séances à partir
// des mêmes faits et des mêmes règles ; sinon, ou en cas d'erreur, on garde les règles.
import { makeSession, repack, setStepMin, addExtra } from './sessions.js';

export const NIVEAUX = [
  { k: 'facile', nom: 'Facile', pour: 'Peu de temps, jambes lourdes ou journée chargée' },
  { k: 'moyen', nom: 'Moyen', pour: 'La séance conseillée aujourd\'hui' },
  { k: 'avance', nom: 'Avancé', pour: 'Grosse forme et du temps devant toi' },
];
export const SPORT_NOM = { run: 'Course', bike: 'Vélo', swim: 'Natation', renfo: 'Renfo', sport: 'Autre' };

/** Courses et compétitions repérées dans l'agenda (et l'objectif du profil). */
const RACE = /trail|\b\d+ ?km\b|marathon|semi|triathlon|duathlon|ironman|70\.3|swimrun|ultra|cross\b|compétition|compet|\bcourse\b(?! d'orientation)|cyclosportive|granfondo|traversée|open ?water/i;
const NOT_RACE = /\bcours\b|partiel|examen|réunion/i;
export function findRaces(events, profile, now = Date.now()) {
  const seen = new Set(), out = [];
  (events || []).forEach(e => {
    if (e.s < now - 864e5 || e.s > now + 200 * 864e5) return;
    if (!RACE.test(e.t || '') || NOT_RACE.test(e.t || '')) return;
    const d = new Date(e.s), date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const k = date + (e.t || '').toLowerCase(); if (seen.has(k)) return; seen.add(k);
    out.push({ date, titre: e.t, heure: e.allDay ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') });
  });
  const p = profile || {};
  if (p.date && new Date(p.date + 'T23:59') >= now && !out.some(r => r.date === p.date)) out.push({ date: p.date, titre: p.objectif || 'Objectif principal', objectif: true });
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
}

const kindOf = s => ['run', 'bike', 'swim', 'renfo'].includes(s) ? s : 'sport';

/** Les 3 niveaux d'une même séance : même objectif, dosage différent. */
export function threeLevels(base, profile, { dispo = 0, bloque = [], seed = 0 } = {}) {
  const refs = profile.refs || {}, lvl = profile.niveau || '';
  const kind = kindOf(base.sport), type = base.type === 'activation' ? 'facile' : (base.type || 'facile');
  const min = +base.duree_min || 45;
  const soft = bloque.length > 0 || base.type === 'activation';
  const f = soft ? [0.75, 1, 1.15] : type === 'qualite' ? [0.75, 1, 1.3] : [0.7, 1, 1.35];
  const cap = dispo ? dispo - 10 : 999;
  let prev = 0;
  return NIVEAUX.map((n, i) => {
    let m = Math.round(min * f[i] / 5) * 5;
    if (i === 2) m = Math.min(m, Math.max(min, cap));
    // chaque niveau doit vraiment différer du précédent (les blocs arrondissent la durée)
    let s, k = 0;
    do { s = makeSession(kind, type, Math.max(20, m + k * 10), refs, lvl, seed); k++; } while (i > 0 && s.duree_min <= prev && k < 4 && m + k * 10 <= Math.max(cap, min * 1.6));
    if (i > 0 && s.duree_min <= prev) s = addExtra(s, kind === 'run' || kind === 'bike' ? 'accel' : kind === 'swim' ? 'educ' : 'gainage');
    prev = s.duree_min;
    if (base.type === 'activation') { s.titre = (i === 0 ? 'Activation courte ' : i === 1 ? 'Activation ' : 'Activation + gammes ') + s.duree_min + ' min'; s.type = 'activation'; }
    return Object.assign(s, { niveau: n.k, quand: base.quand ? base.quand.slice(0, 6) + (() => { const a = +base.quand.slice(0, 2) * 60 + +base.quand.slice(3, 5) + s.duree_min; return String(Math.floor(a / 60) % 24).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); })() : '', lieu: base.lieu, meteo: base.meteo, raisons: base.raisons || [], pour: n.pour });
  });
}

/* ---------- séance sur demande (« je veux… ») sans IA : on comprend l'essentiel ---------- */
export function parseRequest(txt, fallbackSport) {
  const t = (txt || '').toLowerCase();
  const sport = /nat|nage|piscine|crawl|swim|bassin/.test(t) ? 'swim' : /vélo|velo|bike|home ?trainer|zwift|cyclo|vtt|gravel/.test(t) ? 'bike' : /renfo|gainage|muscu|abdos|pompes|squat|ppg/.test(t) ? 'renfo' : /course|footing|run|trail|piste|côte|cote|vma|fractionn|10 ?km|semi|marathon/.test(t) ? 'run' : fallbackSport || 'run';
  const type = /seuil|vma|fraction|interval|pma|css|sweet|tempo|rapide|intens|côte|cote|pyramide|sprint|dur\b|qualit/.test(t) ? 'qualite' : /long|sortie longue|endurance longue/.test(t) ? 'long' : 'facile';
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*h(?:\s*(\d{1,2}))?/), m = t.match(/(\d{2,3})\s*(?:min|mn|')/), km = t.match(/(\d+(?:[.,]\d+)?)\s*(?:km|k\b)/), mtr = t.match(/(\d{3,4})\s*m\b/);
  let min = h ? Math.round(parseFloat(h[1].replace(',', '.')) * 60 + (+h[2] || 0)) : m ? +m[1] : null;
  if (!min && sport === 'swim' && mtr) min = Math.round(+mtr[1] / 100 * 2.3);
  if (!min && km) min = Math.round(parseFloat(km[1].replace(',', '.')) * (sport === 'bike' ? 2.2 : 5.5));
  return { sport, type, min: min || (type === 'long' ? (sport === 'bike' ? 120 : 80) : type === 'qualite' ? 60 : 45) };
}

/* ---------- modification en texte libre sans IA ---------- */
export function editByText(s, txt) {
  const t = (txt || '').toLowerCase(); let out = JSON.parse(JSON.stringify(s)), done = [];
  const tgt = t.match(/(?:à|a|en|sur)\s*(\d{2,3})\s*(?:min|mn)/) || t.match(/(\d{2,3})\s*(?:min|mn)\s*(?:max|maximum|au total|en tout)/);
  const scale = f => { out.steps.forEach(st => { if (st.repeat) { if (st.repeat >= 3) st.repeat = Math.max(1, Math.round(st.repeat * f)); else st.steps.forEach(x => setStepMin(x, x.min * f)); } else if (!st.role || st.role === 'add') setStepMin(st, st.min * f); }); out = repack(out); };
  if (/gainage|abdos|core|planche/.test(t)) { out = addExtra(out, 'gainage'); done.push('gainage ajouté'); }
  if (/accél|accel|lignes? droites?|sprints?/.test(t)) { out = addExtra(out, 'accel'); done.push('accélérations ajoutées'); }
  if (/éducatif|educatif|gammes|technique/.test(t)) { out = addExtra(out, 'educ'); done.push(out.sport === 'swim' ? 'éducatifs ajoutés' : 'gammes ajoutées'); }
  if (/étir|etir|mobilit|stretch/.test(t)) { out = addExtra(out, 'etir'); done.push('étirements ajoutés'); }
  if (tgt) { const want = +tgt[1], f = Math.max(0.3, Math.min(2.5, (want - (out.duree_min - corpsMin(out))) / Math.max(5, corpsMin(out)))); scale(f); done.push(`ramenée à ~${out.duree_min} min`); }
  else if (/raccourc|plus court|moins long|moins de temps|réduis|reduis|enlève|enleve/.test(t)) { scale(0.75); done.push(`raccourcie à ${out.duree_min} min`); }
  else if (/allong|plus long|rallong|ajoute.*(série|rep|tour)|plus de (série|rep)/.test(t)) { scale(1.25); done.push(`allongée à ${out.duree_min} min`); }
  if (/plus facile|moins dur|moins intense|cool|tranquille/.test(t)) { out.steps.forEach(st => { if (st.repeat) st.repeat = Math.max(1, st.repeat - 1); }); out = repack(out); done.push('une série en moins'); }
  if (/plus dur|plus intense|une série de plus|1 série de plus/.test(t)) { out.steps.forEach(st => { if (st.repeat && st.repeat < 20) st.repeat += 1; }); out = repack(out); done.push('une série en plus'); }
  return { s: out, done };
}
const corpsMin = s => s.steps.filter(x => x.role !== 'wu' && x.role !== 'cd').reduce((t, x) => t + (x.repeat ? x.repeat * x.steps.reduce((u, y) => u + y.min, 0) : x.min), 0);

/** Faits envoyés à l'IA : compacts, chiffrés, sans données personnelles inutiles. */
export function aiFacts(o) {
  const p = o.profile || {};
  return {
    date: o.date, jour: new Date(o.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    athlete: { sports: p.sports, niveau: p.niveau, objectif: p.objectif, date_objectif: p.date, chrono_vise: p.chrono, heures_semaine: p.heures, blessures: p.blessures, reperes: p.refs },
    contexte_regles: o.contexte, seance_conseillee_par_les_regles: o.base ? { sport: o.base.sport, type: o.base.type, duree_min: o.base.duree_min, titre: o.base.titre, pourquoi: o.base.raisons } : null,
    contraintes: { creneau_libre_max_min: o.dispo || null, limites_du_jour: o.bloque || [], heure_conseillee: o.base?.quand || '', lieu: o.base?.lieu || '', meteo: o.base?.meteo || '' },
    competitions_a_venir: (o.races || []).map(r => ({ date: r.date, titre: r.titre, dans_jours: Math.round((new Date(r.date + 'T00:00') - new Date(o.date + 'T00:00')) / 864e5) })),
    examens_a_venir: o.exams || [],
    charge: o.load, forme_du_jour_sur_100: o.readiness, volume_strava_par_semaine_h: o.weeks, seances_14_derniers_jours: o.recent,
    plan_de_la_semaine: o.plan, regle_progression: o.rule,
  };
}
