// Propositions de séances pour un jour donné : 2-3 choix chiffrés, avec le pourquoi.
// Tient compte de l'agenda (créneaux libres, trajets), des séances d'avant / d'après, de la forme du jour,
// de l'objectif, du temps disponible dans la semaine et de la météo.
import { session, zonesText, disciplinesOf, tmin } from './planner.js';
import { weatherFor } from './weather.js';

const p2 = n => String(n).padStart(2, '0');
const hhmm = m => p2(Math.floor(m / 60)) + ':' + p2(Math.round(m % 60));
const dk = d => { d = new Date(d); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const minOf = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const grp = t => /Swim/.test(t) ? 'swim' : /Ride|Bike|Cycl/.test(t) ? 'bike' : /Run|Trail/.test(t) ? 'run' : 'oth';
const NOM = { run: 'course', bike: 'vélo', swim: 'natation', renfo: 'renfo', sport: 'sport' };
const DAY0 = 6 * 60 + 30, DAY1 = 21 * 60 + 30;

/** Créneaux libres du jour, trajets compris (présentiel ~45 min, visio ~10 min). */
export function freeWindows({ ev = [], fixed = [], isToday, nowMin }) {
  const busy = ev.filter(e => !e.allDay).map(e => { const pad = e.m === 'visio' ? 10 : 45; return [minOf(e.s) - pad, minOf(e.e) + pad]; });
  fixed.filter(f => ['oui', 'confirmé', 'peut-être'].includes(f.final)).forEach(f => busy.push([tmin(f.slot.s) - (+f.slot.te || 30), tmin(f.slot.e) + 20]));
  busy.sort((a, b) => a[0] - b[0]);
  const out = []; let cur = Math.max(DAY0, isToday ? Math.ceil((nowMin + 20) / 15) * 15 : DAY0);
  busy.forEach(([a, b]) => { if (a - cur >= 30) out.push([cur, Math.min(a, DAY1)]); cur = Math.max(cur, b); });
  if (DAY1 - cur >= 30) out.push([cur, DAY1]);
  return out.filter(([a, b]) => b - a >= 30);
}

const isHardAct = (a, fcmax) => (a.moving_time || 0) >= 1200 && fcmax && a.avg_hr && a.avg_hr >= fcmax * 0.85;
const isLongAct = a => (a.moving_time || 0) >= 80 * 60;
const hardSes = s => s && s.sport !== 'repos' && (s.dur || /seuil|vma|fraction|interval|z4|z5|tempo|sweet|css|intermittent/i.test((s.intensite || '') + ' ' + (s.titre || '')));
const longSes = s => s && /longue|long/i.test(s.titre || '');

/**
 * @param c { date, isToday, nowMin, ev, fixed, inf, infNext, planPrev, planToday, planNext, acts, readiness, hrvDelta, tsb, profile, weather }
 * @returns { contexte: string[], options: [{ titre, sport, duree_min, intensite, detail, quand, lieu, meteo, raisons: string[] }] }
 */
export function propose(c) {
  const p = c.profile || {}, refs = p.refs || {}, fcmax = +refs.fcmax || null, Z = zonesText(p), lvl = p.niveau || '';
  const beginner = /Débutant/.test(lvl);
  const d0 = new Date(c.date); d0.setHours(0, 0, 0, 0);
  const day = dk(d0), dow = (d0.getDay() + 6) % 7, weekend = dow >= 5;
  const ctx = [], block = [];

  // --- agenda : créneaux libres
  const wins = freeWindows(c).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const timed = (c.ev || []).filter(e => !e.allDay);
  if (timed.length) { const last = timed.reduce((a, e) => (e.e > a.e ? e : a), timed[0]); ctx.push(`Cours ${hhmm(minOf(timed[0].s))}-${hhmm(minOf(last.e))}${last.m === 'visio' ? ' (fin en visio)' : ''} : ${wins.length ? 'libre ' + wins.map(([a, b]) => hhmm(a) + '-' + hhmm(b)).sort().join(', ') : 'pas de créneau libre'}`); }
  else ctx.push(wins.length ? 'Pas de cours : journée libre' : 'Plus de créneau libre aujourd\'hui');
  const fixedToday = (c.fixed || []).filter(f => ['oui', 'confirmé'].includes(f.final) && f.slot.k !== 'autre');
  if (fixedToday.length) ctx.push('Déjà prévu : ' + fixedToday.map(f => `${f.slot.t} ${f.slot.s}-${f.slot.e}`).join(', '));

  // --- examens / course
  if (c.inf?.examens?.length) { block.push('jour d\'examen'); ctx.push('Examen aujourd\'hui : ' + c.inf.examens.join(', ')); }
  if (c.inf?.veille_examen?.length) { block.push('examen demain'); ctx.push('Demain : ' + c.inf.veille_examen.join(', ') + ' → rien de dur'); }
  if (c.inf?.charge === 'chargée') block.push('grosse journée de cours');
  // compétitions : objectif du profil + courses repérées dans l'agenda
  const races = (c.races || []).map(r => Object.assign({}, r, { j: Math.round((new Date(r.date + 'T00:00') - d0) / 864e5) })).filter(r => r.j >= 0).sort((a, b) => a.j - b.j);
  const race = races.length ? races[0].j : p.date ? Math.round((new Date(p.date + 'T09:00') - d0) / 864e5) : null;
  const raceName = races.length ? races[0].titre : (p.objectif || 'course');
  let taper = false;
  if (race === 0) { block.push('jour de course'); ctx.push(`Jour de course : ${raceName}`); }
  else if (race != null && race >= 1 && race <= 2) { block.push(race === 1 ? 'course demain' : 'course dans 2 jours'); ctx.push(`${raceName} ${race === 1 ? 'demain' : 'dans 2 jours'} : on garde des jambes`); }
  else if (race != null && race >= 3 && race <= 10) { taper = true; ctx.push(`Affûtage : ${raceName} dans ${race} j (volume réduit, intensité courte)`); }
  else if (race != null && race > 0) ctx.push(`Prochaine course : ${raceName} dans ${race} j`);

  // --- séances d'avant et d'après
  const acts = c.acts || [];
  const yk = dk(new Date(d0.getTime() - 864e5));
  const yActs = acts.filter(a => (a.start_local || '').slice(0, 10) === yk);
  const yHard = yActs.some(a => isHardAct(a, fcmax) || isLongAct(a)) || (c.planPrev || []).some(s => hardSes(s) || longSes(s));
  if (yActs.length) ctx.push('Hier : ' + yActs.map(a => `${a.name || NOM[grp(a.sport_type)]} ${Math.round(a.moving_time / 60)} min`).join(', ') + (yHard ? ' (dur ou long)' : ''));
  if (yHard) block.push('séance dure ou longue hier');
  const tomorrowKey = (c.planNext || []).find(s => hardSes(s) || longSes(s));
  if (tomorrowKey) { block.push('séance clé demain'); ctx.push('Demain : ' + tomorrowKey.titre + ' → on garde des jambes'); }

  // --- 7 derniers jours : intensité, sortie longue, équilibre des sports
  const since = d0.getTime() - 7 * 864e5;
  const last7 = acts.filter(a => { const t = new Date(a.start_local).getTime(); return t >= since && t < d0.getTime(); });
  const nHard = last7.filter(a => isHardAct(a, fcmax)).length, longDone = last7.some(isLongAct);
  const nQual = beginner ? 1 : 2;

  // --- forme du jour
  const r = c.readiness;
  if (r != null) ctx.push(`Forme ${r}/100${c.hrvDelta != null ? ` · VFC ${c.hrvDelta >= 0 ? '+' : ''}${Math.round(c.hrvDelta)} %` : ''}`);
  if (c.tsb != null && c.tsb < -20) { block.push('fatigue accumulée'); ctx.push(`Fatigue accumulée (fraîcheur ${c.tsb})`); }
  if (c.hrvDelta != null && c.hrvDelta < -12) block.push('VFC basse');
  const low = r != null && r < 45, mid = r != null && r < 60;
  if (mid && !low) block.push('forme moyenne');

  // --- temps dispo dans la semaine
  const mon = new Date(d0); mon.setDate(mon.getDate() - dow);
  const doneWeek = acts.filter(a => new Date(a.start_local) >= mon && new Date(a.start_local) < d0).reduce((t, a) => t + (a.moving_time || 0) / 60, 0);
  let weekLeft = null;
  if (+p.heures) { weekLeft = Math.max(0, p.heures * 60 - doneWeek); ctx.push(`Semaine : ${Math.floor(doneWeek / 60)}h${p2(Math.round(doneWeek % 60))} faites sur ${p.heures} h`); }

  // --- choix du sport : le moins travaillé ces 7 jours, l'objectif en priorité, pas le même qu'hier
  const disc = disciplinesOf(p.sports).filter(x => x !== 'renfo');
  const tally = {}; disc.forEach(k => tally[k] = 0);
  last7.forEach(a => { const g = grp(a.sport_type); if (g in tally) tally[g] += (a.moving_time || 0) / 60; });
  const obj = (p.objectif || '') + ' ' + (p.chrono || '') + ' ' + (races[0] && races[0].j <= 70 ? races[0].titre : '');
  const goal = /natation|nage/i.test(obj) ? 'swim' : /vélo|cyclo|fondo|cyclisme/i.test(obj) ? 'bike' : /triathlon|ironman|70\.3|duathlon/i.test(obj) ? null : /km|course|marathon|semi|trail|cross|run/i.test(obj) ? 'run' : null;
  if (goal && goal in tally && race != null && race >= 0 && race <= 70) tally[goal] -= 90;
  yActs.forEach(a => { const g = grp(a.sport_type); if (g in tally) tally[g] += 45; });
  fixedToday.forEach(f => { const k = f.slot.k === 'club' ? 'sport' : f.slot.k; if (k in tally) tally[k] += 200; });
  const ranked = Object.keys(tally).sort((a, b) => tally[a] - tally[b]);

  const hardOk = !block.length && !low;
  const best = wins[0] ? wins[0][1] - wins[0][0] : 0;
  const cap = m => {
    let x = Math.min(m, best ? best - 15 : m);
    if (c.inf?.charge === 'chargée') x = Math.min(x, Math.round(m * 0.75));
    if (c.inf?.veille_examen?.length) x = Math.min(x, 45);
    if (weekLeft != null) x = Math.min(x, Math.max(30, weekLeft));
    if (mid) x = Math.min(x, 45);
    if (taper) x = Math.round(x * 0.75);
    if (race === 1 || race === 2) x = Math.min(x, 35);
    return Math.max(20, Math.round(x / 5) * 5);
  };

  // --- lieu + météo
  const place = (kind, min, win) => {
    const w = win || wins[0]; if (!w) return { quand: '', lieu: '', meteo: null, kind };
    // heure conseillée : le week-end en matinée, en semaine plutôt après les cours (pas à l'aube si on peut éviter)
    const pref = weekend ? 9 * 60 + 30 : (w[1] >= 18 * 60 + min ? 18 * 60 : w[0] < 7 * 60 + 30 && w[1] >= 7 * 60 + 30 + min ? 10 * 60 : w[0]);
    let st = Math.max(w[0], pref); if (st + min > w[1]) st = Math.max(w[0], w[1] - min);
    const en = Math.min(w[1], st + min);
    const m = weatherFor(c.weather, day, st, en);
    let lieu = 'Extérieur', k = kind, note = '';
    if (kind === 'swim') lieu = 'Piscine';
    else if (kind === 'renfo') lieu = 'Maison ou salle';
    else if (kind === 'bike' && m && !m.okBike) { lieu = 'Intérieur'; note = m.nuit ? 'de nuit : home trainer ou vélo de salle' : 'météo : home trainer ou vélo de salle'; }
    else if (kind === 'run' && m && !m.okRun) { lieu = 'Intérieur ou sous la pluie'; note = 'forte pluie : tapis, ou dehors bien équipé'; }
    else if (kind === 'run' && m?.nuit) note = 'de nuit : frontale et gilet réfléchissant';
    if (kind === 'run' && m?.pluie && m.okRun) note = (note ? note + ' · ' : '') + 'pluie probable : veste légère imperméable';
    if (m && lieu.startsWith('Ext') && m.ress <= 3) note = (note ? note + ' · ' : '') + 'froid : gants, bonnet, échauffement plus long';
    const outdoor = kind === 'run' || kind === 'bike' || kind === 'sport';
    return { quand: hhmm(st) + '-' + hhmm(en), lieu, meteo: outdoor ? m : null, note, kind: k };
  };

  const make = (kind, type, min, why, win) => {
    const s = session(kind, type, min, p, Math.floor(d0.getTime() / 864e5) + options.length);
    const pl = place(kind, s.duree_min || min, win);
    const raisons = [...why]; if (pl.note) raisons.push(pl.note);
    return Object.assign(s, { type, quand: pl.quand, lieu: pl.lieu, meteo: pl.meteo ? pl.meteo.txt : '', raisons });
  };

  const options = [];
  if (!wins.length) return { contexte: ctx, options: [{ sport: 'repos', titre: 'Pas de créneau', duree_min: 0, intensite: '', detail: 'Ton agenda est plein (trajets compris). Profite-en pour bien dormir : c\'est aussi de l\'entraînement.', quand: '', lieu: '', meteo: '', raisons: ['Aucun créneau de 30 min libre'] }] };

  // Jour de course : rien d'autre que la course
  if (race === 0) return { contexte: ctx, options: [{ sport: 'repos', titre: 'Jour de course', duree_min: 0, intensite: '', detail: `C'est le jour J (${raceName}). Échauffement 15-20 min avant le départ : footing très facile, gammes, 3-4 accélérations. Pas d'autre séance aujourd'hui.`, quand: '', lieu: '', meteo: '', raisons: ['On garde toute l\'énergie pour la course'] }], dispo: best, bloque: block, races };
  // Veille de course : activation courte
  if (race === 1 && ranked.length) {
    const k = /natation|swim/i.test(raceName) ? 'swim' : /vélo|cyclo/i.test(raceName) ? 'bike' : 'run';
    const o = make(disc.includes(k) ? k : ranked[0], 'facile', 25, ['Veille de course : 20-25 min faciles + quelques accélérations pour réveiller les jambes']);
    o.titre = 'Activation veille de course'; o.type = 'activation';
    options.push(o);
    options.push({ sport: 'repos', titre: 'Repos complet', duree_min: 0, intensite: '', detail: 'Repos, hydratation, repas riche en glucides le soir, préparation du sac.', quand: '', lieu: '', meteo: '', raisons: ['Option tout aussi valable la veille d\'une course'] });
    return { contexte: ctx, options, dispo: best, bloque: block, races };
  }

  // Forme basse : récupération d'abord
  if (low) {
    options.push(Object.assign(make(ranked.includes('swim') ? 'swim' : ranked[0], 'facile', cap(30), ['Forme basse ce matin : on récupère, rien qui fatigue']), { titre: 'Récupération active', intensite: 'Z1' }));
    options.push({ sport: 'repos', titre: 'Repos complet', duree_min: 0, intensite: '', detail: 'Repos. 10 min de mobilité douce le soir si tu veux, et couche-toi tôt.', quand: '', lieu: '', meteo: '', raisons: ['Le repos fait partie du plan quand la forme est basse'] });
    return { contexte: ctx, options, dispo: best, bloque: block, races };
  }

  // 1) la séance prévue au plan (adaptée si besoin), sinon la meilleure séance du jour
  const planned = (c.planToday || []).find(s => s.sport && s.sport !== 'repos' && !s.fixe);
  if (planned) {
    const kind = ['run', 'bike', 'swim', 'renfo'].includes(planned.sport) ? planned.sport : 'sport';
    const hard = hardSes(planned), lg = longSes(planned);
    const type = hard ? (hardOk ? 'qualite' : 'facile') : lg ? (block.length ? 'facile' : 'long') : 'facile';
    const why = ['Séance prévue dans ton plan'];
    if ((hard || lg) && type === 'facile') why.push('Allégée : ' + block.join(', '));
    options.push(make(kind, type, cap(type === 'facile' ? Math.min(+planned.duree_min || 45, 60) : +planned.duree_min || 60), why));
  } else {
    const kind = ranked[0];
    let type = 'facile'; const why = [];
    if (hardOk && nHard < nQual) { type = 'qualite'; why.push(`Séance clé : ${nHard} séance(s) intense(s) sur 7 jours, il en faut ${nQual} (polarisé 80/20)`); }
    else if (!block.length && weekend && !longDone && best >= 100) { type = 'long'; why.push('Pas de sortie longue cette semaine : c\'est le bon jour'); }
    else why.push(block.length ? 'Facile : ' + block.join(', ') : 'Endurance facile : la base du polarisé');
    if (kind === goal) why.push('Priorité à ton objectif');
    else if (tally[kind] <= 0) why.push(`Pas de ${NOM[kind]} depuis 7 jours`);
    const base = type === 'qualite' ? (beginner ? 45 : 60) : type === 'long' ? (kind === 'bike' ? 120 : 90) : 45;
    options.push(make(kind, type, cap(base), why));
  }

  // 2) une autre discipline, facile (ou en intérieur si la météo est mauvaise)
  const first = options[0];
  const badOut = first.lieu && first.lieu.startsWith('Int');
  let alt = ranked.find(k => k !== first.sport && (!badOut || k === 'swim')) || ranked.find(k => k !== first.sport);
  if (alt) {
    const win2 = wins[1] && wins[1][1] - wins[1][0] >= 45 ? wins[1] : wins[0];
    options.push(make(alt, 'facile', cap(45), [badOut && alt === 'swim' ? 'Météo pas terrible : la piscine est à l\'abri' : `Pour varier : ${NOM[alt]} en endurance`, tally[alt] <= 30 ? `Peu de ${NOM[alt]} ces 7 derniers jours` : 'Garde l\'équilibre entre les disciplines'], win2));
  }

  // 3) la version courte, pour un jour sans temps ou sans énergie
  const shortKind = disciplinesOf(p.sports).includes('renfo') || block.length ? 'renfo' : first.sport;
  const sh = make(shortKind, 'facile', Math.min(30, cap(30)), ['Si tu manques de temps ou d\'énergie : 30 min suffisent pour garder le rythme']);
  sh.titre = shortKind === 'renfo' ? 'Renfo / prévention' : 'Version courte : ' + sh.titre;
  options.push(sh);

  return { contexte: ctx, options: options.slice(0, 3), dispo: best, bloque: block, races, taper };
}
