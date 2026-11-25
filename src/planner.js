import { makeSession } from './sessions.js';
// Planificateur intégré, gratuit et hors ligne. Il applique les règles du coach :
// polarisé 80/20, +10 % max par semaine, semaine allégée toutes les 3-4 semaines,
// rien de dur le jour ou la veille d'un examen, séances chiffrées.
// Si une clé IA est configurée, l'appli peut affiner ce plan (voir coach-ai).

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export const disciplinesOf = (sports = []) => {
  const s = new Set();
  sports.forEach(x => {
    if (/Triathlon/.test(x)) { s.add('swim'); s.add('bike'); s.add('run'); }
    else if (/Course|Trail|Rando/.test(x)) s.add('run');
    else if (/Vélo|VTT/.test(x)) s.add('bike');
    else if (/Natation/.test(x)) s.add('swim');
    else if (/Muscu|CrossFit/.test(x)) s.add('renfo');
    else s.add('sport');
  });
  if (!s.size) s.add('run');
  return [...s];
};

export function zonesText(p) {
  const r = p.refs || {};
  const fc = +r.fcmax || null;
  const z = (a, b) => fc ? ` (${Math.round(fc * a)}-${Math.round(fc * b)} bpm)` : '';
  return {
    z1: 'Z1' + z(.6, .7), z2: 'Z2' + z(.7, .8), z3: 'Z3' + z(.8, .87), z4: 'Z4' + z(.88, .93), z5: 'Z5' + z(.94, 1),
    seuil: r.seuil ? `allure seuil ${r.seuil}/km` : 'allure seuil (tu peux tenir ~1 h, phrases courtes)',
    ftp: +r.ftp ? (a, b) => `${Math.round(r.ftp * a)}-${Math.round(r.ftp * b)} W` : (a, b) => `${Math.round(a * 100)}-${Math.round(b * 100)} % FTP`,
    css: r.css ? `CSS ${r.css}/100 m` : 'allure CSS (rythme tenable 30 min)',
  };
}

/** Séance chiffrée (voir sessions.js) : la durée est la somme des blocs. */
export function session(kind, type, min, p = {}, seed = 0) {
  return makeSession(kind, type, min, p.refs || {}, p.niveau || '', seed);
}

/**
 * @param {object} a
 *  profile, days: [{date, charge, examens[], veille_examen[]}] (7), fixed: [{dayIndex, slot, final}],
 *  rule: {minutes_max, allegee_obligatoire}, stravaWeeks, readiness
 */
export function buildPlan(a) {
  const p = a.profile || {};
  const disc = disciplinesOf(p.sports);
  const lvl = p.niveau || '';
  const Z = zonesText(p);
  const wk = Math.floor(new Date(a.days[0].date).getTime() / (7 * 864e5));
  const okDays = (p.jours && p.jours.length) ? p.jours : DAYS;

  // ---- volume cible
  const weeks = a.stravaWeeks ? Object.keys(a.stravaWeeks).sort().slice(-4, -1).map(k => { const w = a.stravaWeeks[k]; return (w.swim + w.bike + w.run + w.oth) * 60; }) : [];
  const stravaAvg = weeks.length ? weeks.reduce((x, y) => x + y, 0) / weeks.length : null;
  let target = a.rule?.minutes_max ?? (stravaAvg ? stravaAvg * 1.05 : null) ?? (+p.heures ? p.heures * 60 * .8 : 300);
  if (+p.heures) target = Math.min(target, p.heures * 60);
  target = Math.max(90, target);
  const race = p.date && (new Date(p.date) - new Date(a.days[0].date)) / 864e5;
  const allegee = !!a.rule?.allegee_obligatoire || (race != null && race >= 0 && race < 7);
  if (allegee) target *= .65;
  target = Math.round(target / 5) * 5;

  const jours = DAYS.map((d, i) => ({ jour: d, seances: [], _info: a.days[i] }));
  let used = 0;

  // ---- créneaux fixes de la semaine type (confirmés ou possibles)
  (a.fixed || []).forEach(f => {
    if (!['oui', 'confirmé'].includes(f.final)) return;
    const sl = f.slot; if (sl.k === 'autre') return;
    const min = Math.round((tmin(sl.e) - tmin(sl.s)));
    const kind = sl.k === 'club' ? 'sport' : sl.k;
    const s = session(kind, 'facile', min, p, wk);
    s.titre = sl.t; s.intensite = 'Créneau fixe';
    s.detail = `Ton créneau ${sl.lieu ? 'à ' + sl.lieu + ' ' : ''}de ${sl.s} à ${sl.e}.\n` + (kind === 'swim' ? 'Si l’entraîneur ne donne rien : ' + session('swim', 'facile', min, p, wk).detail : 'Reste majoritairement en endurance, sauf consigne du club.');
    s.pourquoi = 'Créneau de ta semaine type, compatible avec tes cours.';
    s.fixe = true; s.quand = sl.s + '-' + sl.e; s.duree_min = min; s.icu = null; s.steps = null; s.indoor = null; s.dur = false;
    jours[f.dayIndex].seances.push(s); used += min;
  });

  const restLeft = Math.max(0, target - used);
  const hardOk = i => { const d = jours[i]._info; return !d.examens.length && !d.veille_examen.length && d.charge !== 'chargée' && okDays.includes(DAYS[i]); };
  const free = i => okDays.includes(DAYS[i]) && !jours[i]._info.examens.length;

  // ---- choix des séances clés (20 %)
  const nQual = allegee ? 1 : (/Débutant/.test(lvl) || target < 200 ? 1 : 2);
  const qualDays = [];
  for (const i of [1, 3, 2, 4, 0]) { if (qualDays.length >= nQual) break; if (hardOk(i) && !qualDays.some(q => Math.abs(q - i) < 2)) qualDays.push(i); }
  const longDay = [6, 5].find(i => hardOk(i) && !qualDays.includes(i)) ?? [6, 5].find(free);

  // ---- rotation des disciplines
  const rot = disc.filter(d => d !== 'renfo');
  if (!rot.length) rot.push(disc[0]);
  const nSess = Math.min(okDays.length + 2, Math.max(3, Math.round(restLeft / 50)));
  const plan = [];
  qualDays.forEach((d, k) => plan.push({ d, type: 'qualite', kind: rot[(k + 1) % rot.length] === 'swim' && rot.length > 1 ? rot[(k + 2) % rot.length] : rot[(k + 1) % rot.length] }));
  if (longDay != null) plan.push({ d: longDay, type: 'long', kind: rot.includes('bike') ? 'bike' : rot[0] });
  if (rot.includes('run') && rot.includes('bike') && longDay === 6 && free(5)) plan.push({ d: 5, type: 'long', kind: 'run' });
  const order = [0, 2, 4, 1, 3, 5, 6];
  let r = 0;
  while (plan.length < nSess && r < 40) {
    const d = order[r % 7]; r++;
    if (!free(d)) continue;
    const already = plan.filter(x => x.d === d).length + jours[d].seances.length;
    if (already >= (r > 14 ? 2 : 1)) continue;
    const need = rot.find(k => !plan.some(x => x.kind === k) && !jours.some(j => j.seances.some(s => s.sport === k))) || rot[plan.length % rot.length];
    plan.push({ d, type: 'facile', kind: need });
  }
  if (disc.includes('renfo') || /Intermédiaire|Confirmé|Compétiteur|Élite/.test(lvl)) {
    const d = order.find(i => free(i) && !plan.some(x => x.d === i && x.type !== 'facile'));
    if (d != null) plan.push({ d, type: 'facile', kind: 'renfo', fixedMin: 30 });
  }

  // ---- durées : la séance longue pèse plus, les jours chargés sont raccourcis
  const weight = x => (x.type === 'long' ? 1.8 : x.type === 'qualite' ? 1.1 : 1) * (jours[x.d]._info.charge === 'chargée' ? .6 : 1);
  const flex = plan.filter(x => !x.fixedMin);
  const wsum = flex.reduce((t, x) => t + weight(x), 0) || 1;
  const avail = Math.max(0, restLeft - plan.filter(x => x.fixedMin).reduce((t, x) => t + x.fixedMin, 0));
  plan.forEach(x => {
    let min = x.fixedMin || Math.round(avail * weight(x) / wsum / 5) * 5;
    const cap = x.type === 'long' ? (x.kind === 'bike' ? 240 : 150) : x.kind === 'swim' ? 75 : 90;
    const floor = { run: { facile: 35, qualite: 50, long: 70 }, bike: { facile: 45, qualite: 60, long: 90 }, swim: { facile: 40, qualite: 40, long: 45 } }[x.kind]?.[x.type] || 30;
    min = Math.max(floor, Math.min(cap, min));
    const day = jours[x.d]._info;
    if (day.veille_examen.length) min = Math.min(min, 45);
    const s = session(x.kind, x.type, min, p, wk + x.d);
    s.pourquoi = x.type === 'qualite' ? 'Séance clé de la semaine (les 20 % d’intensité).' : x.type === 'long' ? 'Le volume en endurance construit ton moteur.' : day.veille_examen.length ? 'Veille d’examen : court et facile, pour garder le rythme sans fatigue.' : 'Endurance facile : c’est la base du polarisé.';
    jours[x.d].seances.push(s);
  });

  jours.forEach(j => { if (!j.seances.length) j.seances.push({ sport: 'repos', titre: 'Repos', duree_min: 0, intensite: '', detail: '', pourquoi: j._info.examens.length ? 'Jour d’examen.' : 'Récupération.' }); delete j._info; });
  const total = jours.reduce((t, j) => t + j.seances.reduce((u, s) => u + (+s.duree_min || 0), 0), 0);
  const conseils = [];
  if (allegee) conseils.push('Semaine allégée : volume réduit d’environ 35 %, on garde un peu d’intensité courte pour rester vif.');
  if (a.days.some(d => d.examens.length)) conseils.push('Examens cette semaine : rien de dur la veille ni le jour J, et priorité au sommeil.');
  if (a.readiness != null && a.readiness < 45) conseils.push('Forme basse ce matin : remplace la première séance par du repos ou 30 min très faciles.');
  if (!(p.refs && (p.refs.fcmax || p.refs.seuil || p.refs.ftp || p.refs.css))) conseils.push('Ajoute tes repères (FC max, seuil, FTP, CSS) dans ton profil pour des zones précises.');
  return {
    titre: allegee ? 'Semaine allégée' : `Semaine de ${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`,
    resume: `${plan.filter(x => x.type === 'qualite').length} séance(s) clé(s), le reste en endurance facile. Volume visé ${Math.round(target)} min${a.rule?.minutes_max ? ' (+10 % max par rapport à la semaine dernière)' : ''}.`,
    allegee, jours, conseils: conseils.slice(0, 3), source: 'planificateur',
  };
}

export const tmin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
