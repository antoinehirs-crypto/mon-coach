// Bibliothèque de séances chiffrées. Chaque séance est une suite de blocs ; sa durée est la somme des blocs.
// Cibles calculées depuis tes repères (FC max, allure seuil, VMA, FTP, CSS) ; à défaut, en % ou en ressenti.
// Sortie : { sport, type, titre, intensite, duree_min, steps, detail, icu, icuType, indoor? }

const p2 = n => String(n).padStart(2, '0');
const sec = t => { const m = String(t || '').match(/(\d+)[:'h](\d{1,2})/); return m ? +m[1] * 60 + +m[2] : null; };
const mmss = s => Math.floor(s / 60) + ':' + p2(Math.round(s % 60) % 60);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r5 = x => Math.round(x / 5) * 5;

function ctx(refs = {}, lvl = '') {
  const fc = +refs.fcmax || null, s = sec(refs.seuil), vma = +refs.vma || (s ? 3600 / s / 0.85 : null), ftp = +refs.ftp || null, css = sec(refs.css);
  const lv = /Débutant/.test(lvl) ? 0 : /Intermédiaire/.test(lvl) || !lvl ? 1 : 2;
  return {
    lv, s, vma, ftp, css,
    hr: (a, b) => fc ? `${Math.round(fc * a)}-${Math.round(fc * b)} bpm` : `${Math.round(a * 100)}-${Math.round(b * 100)} % FC max`,
    ihr: (a, b) => `${Math.round(a * 100)}-${Math.round(b * 100)}% HR`,
    pace: (lo, hi) => `${mmss(lo)}-${mmss(hi)}/km`,
    w: (a, b) => ftp ? `${Math.round(ftp * a)}-${Math.round(ftp * b)} W` : `${Math.round(a * 100)}-${Math.round(b * 100)} % FTP`,
    iw: (a, b) => `${Math.round(a * 100)}-${Math.round(b * 100)}%`,
    p100: (lo, hi) => `${mmss(lo)}-${mmss(hi)}/100 m`,
  };
}

// --- blocs
const B = (label, min, cible, icu, extra = {}) => Object.assign({ label, min, cible, icu }, extra);
const R = (n, steps, label) => ({ repeat: n, steps, label });
const total = steps => steps.reduce((t, s) => t + (s.repeat ? s.repeat * total(s.steps) : s.min), 0);
const fmtMin = m => m >= 1 ? (Number.isInteger(m) ? m + ' min' : Math.floor(m) + ' min ' + p2(Math.round(m % 1 * 60))) : Math.round(m * 60) + ' s';
const stepLine = s => s.repeat ? `${s.repeat} × ( ${s.steps.map(stepLine).join(' + ')} )` : `${s.dist ? s.dist + ' m' : fmtMin(s.min)} ${s.label}${s.cible ? ' · ' + s.cible : ''}${s.lap ? ' (fin : appui sur Lap)' : ''}`;
const icuOf = steps => steps.map(s => s.repeat ? `\n${s.repeat}x\n${s.steps.map(x => x.icu).join('\n')}\n` : s.icu).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const icuMin = m => { const t = Math.round(m * 60), a = Math.floor(t / 60), b = t % 60; return a ? a + 'm' + (b ? b + 's' : '') : b + 's'; };

function pack(sport, type, titre, intensite, wu, main, cd, extra = {}) {
  if (wu) wu.role = 'wu'; if (cd) cd.role = 'cd';
  const steps = [wu, ...main, cd].filter(Boolean);
  const min = Math.round(total(steps));
  const detail = `Échauffement : ${stepLine(wu)}\nCorps : ${main.map(stepLine).join('\n  puis ')}\nRetour au calme : ${stepLine(cd)}\nDurée totale : ${min} min`;
  const tpl = titre.includes('{T}') ? titre : null;
  titre = titre.replace('{T}', min);
  return Object.assign({ sport, type, titre, tpl, intensite, duree_min: min, steps, detail, icu: icuOf(steps), icuType: { run: 'Run', bike: 'Ride', swim: 'Swim' }[sport] || null, dur: type === 'qualite' }, extra);
}

/* ---------------- COURSE ---------------- */
function run(type, min, c, seed) {
  const easy = c.s ? ' · ~' + c.pace(c.s + 55, c.s + 80) : '';
  const wu = (m = 15) => B('échauffement progressif', m, c.hr(.65, .75), `- Press lap Échauffement ${m}m ${c.ihr(.65, .75)} intensity=warmup`, { lap: true });
  const cd = (m = 10) => B('retour au calme en trottinant', m, c.hr(.6, .7), `- Press lap Retour au calme ${m}m ${c.ihr(.6, .7)} intensity=cooldown`, { lap: true });
  if (type === 'facile') {
    const body = clamp(r5(min - 15), 20, 75);
    return pack('run', type, 'Footing {T} min', 'Z2', wu(10),
      [B('endurance fondamentale', body, c.hr(.7, .8) + easy, `- Endurance ${body}m ${c.ihr(.7, .8)}`), R(4, [B('ligne droite souple et rapide', 1 / 3, 'relâché', '- Accélération 20s 85-92% HR'), B('trot', 1 / 3, '', '- Trot 20s 60-70% HR')])],
      cd(5));
  }
  if (type === 'long') {
    const body = clamp(r5(min - 15), 50, c.lv === 0 ? 80 : 130);
    const finish = c.lv === 2 && body >= 75;
    const main = finish ? [B('endurance', body - 15, c.hr(.7, .8) + easy, `- Endurance ${body - 15}m ${c.ihr(.7, .8)}`), B('allure marathon / tempo', 15, c.s ? c.pace(c.s + 15, c.s + 25) : c.hr(.82, .87), `- Tempo 15m ${c.s ? c.pace(c.s + 15, c.s + 25) + ' Pace' : c.ihr(.82, .87)}`)]
      : [B('endurance régulière', body, c.hr(.7, .8) + easy, `- Endurance ${body}m ${c.ihr(.7, .8)}`)];
    return pack('run', type, 'Sortie longue {T} min', finish ? 'Z2 + fin tempo' : 'Z2', wu(10), main, cd(5), { conseil: 'Boire toutes les 20 min au-delà de 1 h 15, 30-60 g de glucides par heure.' });
  }
  // qualité : variantes selon le niveau, tournantes d'une semaine à l'autre
  const th = c.s ? c.pace(c.s - 3, c.s + 5) : c.hr(.86, .91), thI = c.s ? c.pace(c.s - 3, c.s + 5) + ' Pace' : c.ihr(.86, .91);
  const pv = c.vma ? 3600 / c.vma : null, vm = pv ? c.pace(pv * .98, pv * 1.03) : c.hr(.92, .97), vmI = pv ? c.pace(pv * .98, pv * 1.03) + ' Pace' : c.ihr(.92, .97);
  const room = Math.max(20, min - 25);
  const V = [
    () => { const n = clamp(Math.floor(room / 12), 2, 4); return ['Seuil ' + n + ' × 10 min', 'Seuil Z4', [R(n, [B('au seuil', 10, th, `- Seuil 10m ${thI} intensity=interval`), B('récup trot', 2, c.hr(.6, .72), `- Récup 2m ${c.ihr(.6, .72)} intensity=recovery`)])]]; },
    () => { const n = clamp(Math.floor(room / 8), 3, 6); return ['Seuil ' + n + ' × 6 min', 'Seuil Z4', [R(n, [B('au seuil', 6, th, `- Seuil 6m ${thI} intensity=interval`), B('récup trot', 1.5, c.hr(.6, .72), `- Récup 1m30s ${c.ihr(.6, .72)} intensity=recovery`)])]]; },
    () => { const n = clamp(Math.floor(room / 3.3), 6, 12); return ['VMA ' + n + ' × 400 m', 'VMA Z5', [R(n, [B('vite', pv ? +(pv * .4 / 60).toFixed(2) : 1.5, vm, `- Rapide 400mtr ${vmI} intensity=interval`, { dist: 400 }), B('récup trot', 1.5, 'très lent', `- Récup 1m30s ${c.ihr(.6, .72)} intensity=recovery`)])]]; },
    () => { const n = clamp(Math.floor(room / 5.5), 4, 8); return ['VMA ' + n + ' × 800 m', 'VMA Z5', [R(n, [B('rapide', pv ? +(pv * .8 / 60 * 1.03).toFixed(2) : 3.2, pv ? c.pace(pv * 1.02, pv * 1.06) : c.hr(.9, .95), `- Rapide 800mtr ${pv ? c.pace(pv * 1.02, pv * 1.06) + ' Pace' : c.ihr(.9, .95)} intensity=interval`, { dist: 800 }), B('récup trot', 2, 'très lent', `- Récup 2m ${c.ihr(.6, .72)} intensity=recovery`)])]]; },
    () => { const k = clamp(Math.floor(room / 13), 1, 3); const set = () => R(10, [B('vite', .5, vm, `- Rapide 30s ${vmI} intensity=interval`), B('trot', .5, 'trot', `- Trot 30s ${c.ihr(.6, .75)} intensity=recovery`)]); return [k + ' × 10 × 30/30', 'VMA courte', [...Array(k)].flatMap((_, i) => i < k - 1 ? [set(), B('récup entre séries', 3, 'trot', `- Récup 3m ${c.ihr(.6, .72)} intensity=recovery`)] : [set()])]; },
    () => { const m = clamp(r5(room - 5), 15, 30); return ['Tempo ' + m + ' min', 'Tempo Z3', [B('tempo continu', m, c.s ? c.pace(c.s + 8, c.s + 18) : c.hr(.83, .88), `- Tempo ${m}m ${c.s ? c.pace(c.s + 8, c.s + 18) + ' Pace' : c.ihr(.83, .88)} intensity=interval`)]]; },
  ];
  const pool = c.lv === 0 ? [1, 5, 2] : c.lv === 1 ? [0, 2, 1, 5, 3, 4] : [0, 3, 1, 4, 2, 5];
  const [titre, inten, main] = V[pool[seed % pool.length]]();
  return pack('run', 'qualite', titre, inten, wu(15), main, cd(10));
}

/* ---------------- VÉLO (dehors + home trainer) ---------------- */
function bike(type, min, c, seed) {
  const wu = (m = 15) => B('échauffement progressif', m, c.w(.5, .65), `- Échauffement ${m}m ramp ${c.iw(.45, .65)}`);
  const cd = (m = 10) => B('souple', m, c.w(.4, .55), `- Retour au calme ${m}m ${c.iw(.4, .55)}`);
  let out, ht;
  if (type === 'facile' || type === 'long') {
    const body = type === 'long' ? clamp(r5(min - 20), 75, c.lv === 0 ? 120 : 200) : clamp(r5(min - 20), 30, 90);
    out = pack('bike', type, (type === 'long' ? 'Sortie longue vélo {T} min' : 'Vélo endurance {T} min'), 'Z2', wu(10),
      [B('endurance, cadence 85-95 tr/min', body, c.w(.56, .75), `- Endurance ${body}m ${c.iw(.56, .75)} 90rpm`)], cd(10), type === 'long' ? { conseil: '40-60 g de glucides par heure, boire 500 ml/h.' } : {});
    const hb = clamp(r5(Math.min(body, 75) - 10), 25, 65);
    ht = pack('bike', type, 'Home trainer endurance {T} min', 'Z2', wu(10),
      [B('endurance', hb, c.w(.6, .72), `- Endurance ${hb}m ${c.iw(.6, .72)} 90rpm`), R(5, [B('haute cadence 105-110 tr/min', 1, c.w(.65, .75), `- Cadence 1m ${c.iw(.65, .75)} 110rpm`)])], cd(10),
      { conseil: 'En intérieur, 45-75 min suffisent : sans pauses ni descentes, c’est plus dense que dehors. Ventilateur et serviette.' });
    out.indoor = ht; return out;
  }
  const room = Math.max(30, min - 25);
  const V = [
    () => { const n = clamp(Math.floor(room / 16), 2, 4); return ['Sweet spot ' + n + ' × 12 min', 'Z3-Z4', [R(n, [B('sweet spot', 12, c.w(.88, .93), `- Sweet spot 12m ${c.iw(.88, .93)} intensity=interval`), B('souple', 4, c.w(.5, .6), `- Récup 4m ${c.iw(.5, .6)} intensity=recovery`)])]]; },
    () => { const n = clamp(Math.floor(room / 12), 3, 5); return ['Seuil ' + n + ' × 8 min', 'Seuil Z4', [R(n, [B('au seuil', 8, c.w(.95, 1.02), `- Seuil 8m ${c.iw(.95, 1.02)} intensity=interval`), B('souple', 4, c.w(.5, .6), `- Récup 4m ${c.iw(.5, .6)} intensity=recovery`)])]]; },
    () => { const n = clamp(Math.floor(room / 8), 4, 6); return ['PMA ' + n + ' × 4 min', 'VO2 Z5', [R(n, [B('PMA', 4, c.w(1.08, 1.15), `- PMA 4m ${c.iw(1.08, 1.15)} intensity=interval`), B('souple', 4, c.w(.45, .55), `- Récup 4m ${c.iw(.45, .55)} intensity=recovery`)])]]; },
    () => { const k = clamp(Math.floor(room / 13), 2, 3); return [k + ' × 8 × 40/20', 'VO2 court', [...Array(k)].map(() => R(8, [B('fort', 2 / 3, c.w(1.15, 1.25), `- Fort 40s ${c.iw(1.15, 1.25)} intensity=interval`), B('souple', 1 / 3, c.w(.4, .5), `- Souple 20s ${c.iw(.4, .5)} intensity=recovery`)])).flatMap((r, i, a) => i < a.length - 1 ? [r, B('récup entre séries', 5, c.w(.45, .55), `- Récup 5m ${c.iw(.45, .55)} intensity=recovery`)] : [r])]; },
  ];
  const pool = c.lv === 0 ? [0, 1] : [0, 1, 2, 3];
  const [titre, inten, main] = V[pool[seed % pool.length]]();
  out = pack('bike', 'qualite', titre, inten, wu(15), main, cd(10), { conseil: 'Idéal sur home trainer (mode ERG) : les watts sont tenus sans feux ni descentes. Dehors : choisis une route plate ou une montée régulière.' });
  out.indoor = Object.assign({}, out, { titre: 'Home trainer : ' + titre, conseil: 'Mode ERG conseillé, ventilateur, bidon à portée. Même séance, cibles en watts.' });
  return out;
}

/* ---------------- NATATION ---------------- */
function swim(type, min, c, seed) {
  const css = c.css || 120, easyP = css + 15;
  const dm = (dist, pace, rest = 0) => +(dist / 100 * pace / 60 + rest / 60).toFixed(2);
  const Sx = (n, dist, label, pace, rest, cible, icu) => R(n, [B(label, dm(dist, pace, rest), cible, icu, { dist })]);
  const wu = B('nage libre souple + 4 × 50 m éducatifs', dm(400, easyP, 60), 'facile', `- Échauffement 400mtr ${c.css ? c.p100(easyP - 5, easyP + 5) + ' Pace' : 'Z1 Pace'} intensity=warmup`, { dist: 400 });
  const cd = B('souple, dos ou brasse', dm(200, easyP + 10), 'très facile', `- Retour au calme 200mtr intensity=cooldown`, { dist: 200 });
  const cs = c.css ? c.p100(css - 2, css + 3) : 'allure CSS (tenable 30 min)', csI = c.css ? c.p100(css - 2, css + 3) + ' Pace' : 'Z3 Pace';
  const en = c.css ? c.p100(easyP - 5, easyP + 5) : 'aisé', enI = c.css ? c.p100(easyP - 5, easyP + 5) + ' Pace' : 'Z2 Pace';
  let titre, inten, main;
  if (type === 'qualite') {
    const V = [
      () => { const n = clamp(Math.floor((min - 15) / 2.3), 6, 12); return ['CSS ' + n + ' × 100 m', 'Seuil', [Sx(n, 100, 'allure CSS, 15 s de récup', css, 15, cs, `- CSS 100mtr ${csI} intensity=interval`)]]; },
      () => { const n = clamp(Math.floor((min - 15) / 4.5), 3, 6); return ['CSS ' + n + ' × 200 m', 'Seuil', [Sx(n, 200, 'allure CSS, 20 s de récup', css + 2, 20, cs, `- CSS 200mtr ${csI} intensity=interval`)]]; },
      () => ['Pyramide 100-200-300-200-100', 'Seuil', [100, 200, 300, 200, 100].map(d => B('CSS, 20 s de récup', dm(d, css + 2, 20), cs, `- CSS ${d}mtr ${csI} intensity=interval`, { dist: d }))],
    ];
    [titre, inten, main] = V[seed % V.length]();
  } else if (type === 'long') {
    titre = 'Natation endurance 3 × 500 m'; inten = 'Z2'; main = [Sx(3, 500, 'régulier, 30 s de récup', easyP, 30, en, `- Endurance 500mtr ${enI}`)];
  } else {
    titre = 'Natation technique'; inten = 'Z2';
    main = [Sx(clamp(Math.floor((min - 15) / 2.8), 4, 10), 100, '(25 m éducatif + 75 m nage complète), 20 s de récup', easyP, 20, en, `- Technique 100mtr ${enI}`), Sx(4, 50, 'pull-buoy, respiration tous les 3 temps', easyP, 15, en, `- Pull 50mtr ${enI}`)];
  }
  const s = pack('swim', type, titre, inten, wu, main, cd);
  const meters = s.steps.reduce((t, x) => t + (x.repeat ? x.repeat * x.steps.reduce((u, y) => u + (y.dist || 0), 0) : x.dist || 0), 0);
  s.titre += ` (${(meters / 1000).toFixed(1)} km)`;
  s.detail += `\nDistance : ${meters} m${c.css ? '' : ' · ajoute ta CSS au profil pour des allures précises'}`;
  return s;
}

/* ---------------- RENFO ---------------- */
function renfo(type, min) {
  const lourd = type === 'qualite';
  const tours = lourd ? 4 : clamp(Math.round((min - 13) / 7), 2, 4);
  const main = lourd ? [B('squat ou soulevé de terre, 5 répétitions à ~80 %, 2 min 30 de récup', 4 * 3, 'lourd', ''), B('développé couché 3 × 8 + tirage 3 × 8', 12, 'modéré', ''), B('gainage : planche 3 × 45 s, latéral 3 × 30 s', 6, '', '')]
    : [R(tours, [B('squat 12, fentes 10/jambe, pont fessier 15, mollets 15, planche 40 s', 6, 'contrôlé', ''), B('repos', 1, '', '')])];
  const s = pack('renfo', type, lourd ? 'Musculation force' : 'Renfo / prévention', lourd ? 'Lourd' : 'Modéré', B('mobilité hanches, chevilles, épaules', 8, '', ''), main, B('étirements doux', 5, '', ''));
  s.icu = null; s.icuType = null; return s;
}

/* ---------------- autre ---------------- */
function other(type, min) {
  const body = clamp(r5(min - 20), 20, 90);
  return pack('sport', type, type === 'qualite' ? 'Physique intermittent' : 'Endurance générale', type === 'qualite' ? 'Z4-Z5' : 'Z2', B('facile', 10, '', ''),
    type === 'qualite' ? [R(2, [B('8 × 15 s vite / 15 s récup', 4, 'Z5', ''), B('récup', 3, '', '')])] : [B('activité continue (footing, vélo, rameur)', body, 'Z2', '')], B('mobilité', 10, '', ''));
}

/**
 * @param kind 'run'|'bike'|'swim'|'renfo'|'sport'  @param type 'facile'|'qualite'|'long'
 * @param min durée visée (indicative : la durée réelle est celle des blocs)  @param seed varie les séances
 */
export function makeSession(kind, type, min, refs, lvl, seed = 0) {
  const c = ctx(refs, lvl);
  const s = kind === 'run' ? run(type, min, c, seed) : kind === 'bike' ? bike(type, min, c, seed) : kind === 'swim' ? swim(type, min, c, seed) : kind === 'renfo' ? renfo(type, min) : other(type, min);
  return s;
}
export { stepLine };

/* ---------------- édition d'une séance (après le choix du niveau) ---------------- */
const copy = o => JSON.parse(JSON.stringify(o));
const ROLE = { wu: 'Échauffement : ', cd: 'Retour au calme : ', add: 'En plus : ' };
const meters = steps => steps.reduce((t, x) => t + (x.repeat ? x.repeat * meters(x.steps) : x.dist || 0), 0);

/** Recalcule durée, texte et format montre après une modification des blocs. */
export function repack(s) {
  s = copy(s);
  const min = Math.round(total(s.steps));
  const m = meters(s.steps);
  s.duree_min = min;
  s.detail = s.steps.map((x, i) => (ROLE[x.role] || (i === 0 ? '' : '• ')) + stepLine(x)).join('\n') + `\nDurée totale : ${min} min` + (s.sport === 'swim' && m ? `\nDistance : ${m} m` : '');
  s.titre = (s.tpl ? s.tpl.replace('{T}', min) : String(s.titre || '')).replace(/\(\d+(\.\d)? km\)/, s.sport === 'swim' && m ? `(${(m / 1000).toFixed(1)} km)` : '$&');
  s.icu = s.icuType ? icuOf(s.steps.filter(x => x.icu || x.repeat)) : null;
  if (s.indoor) delete s.indoor; // la variante home trainer ne correspond plus
  return s;
}

/** Change la durée (ou la distance) d'un bloc simple, en gardant le format montre cohérent. */
export function setStepMin(st, m) {
  m = Math.max(1 / 6, m);
  if (st.dist) {
    const d = Math.max(25, Math.round(st.dist * m / st.min / 25) * 25);
    st.icu = (st.icu || '').replace(/\d+mtr/, d + 'mtr'); st.min = +(st.min * d / st.dist).toFixed(2); st.dist = d;
  } else {
    st.min = Math.round(m * 6) / 6;
    st.icu = (st.icu || '').replace(/(\s)(\d+m\d+s|\d+m|\d+s)(?=\s|$)/, '$1' + icuMin(st.min));
  }
  return st;
}

/** Blocs à ajouter en un clic. */
export const EXTRAS = {
  gainage: () => B('gainage : planche 45 s, latéral 30 s/côté, pont fessier 15, superman 12 (×2)', 10, '', '', { role: 'add' }),
  accel: sport => sport === 'bike' ? R(4, [B('sprint assis', 1 / 4, 'très fort', '- Sprint 15s 150% intensity=interval'), B('souple', 1.75, 'facile', '- Souple 1m45s 50% intensity=recovery')], 'sprints')
    : R(4, [B('ligne droite rapide et relâchée', 1 / 3, 'vite, pas à fond', '- Accélération 20s 85-92% HR intensity=interval'), B('retour en trottinant', 2 / 3, '', '- Trot 40s 60-70% HR intensity=recovery')], 'accélérations'),
  educ: sport => sport === 'swim' ? R(4, [B('éducatif (rattrapé, poings fermés, 6-1-6)', 1, 'souple', '- Éducatif 50mtr Z1 Pace', { dist: 50 })]) : B('gammes : montées de genoux, talons-fesses, pas chassés', 8, '', '- Gammes 8m 60-70% HR', { role: 'add' }),
  calme: () => B('retour au calme supplémentaire', 5, 'très facile', '- Retour au calme 5m 55-65% HR intensity=cooldown', { role: 'add' }),
  etir: () => B('étirements et mobilité', 10, '', '', { role: 'add' }),
};
export function addExtra(s, key) {
  s = copy(s); const b = EXTRAS[key](s.sport);
  if (s.sport === 'bike' && b.icu) b.icu = b.icu.replace(/ \d+-\d+% HR/, ' 50-60%');
  const cdAt = s.steps.findIndex(x => x.role === 'cd');
  if (key === 'accel' || (key === 'educ' && s.sport === 'swim')) s.steps.splice(cdAt >= 0 ? cdAt : s.steps.length, 0, b);
  else if (key === 'educ') s.steps.splice(1, 0, b);
  else s.steps.push(b);
  return repack(s);
}

/** Séance rédigée par l'IA -> même format que la bibliothèque (texte, montre). */
export function fromAI(o) {
  const tgt = x => !x.ref || x.ref === 'none' || !x.hi ? '' : x.ref === 'hr' ? ` ${x.lo}-${x.hi}% HR` : x.ref === 'ftp' ? ` ${x.lo}-${x.hi}%` : ` ${x.lo}-${x.hi}% Pace`;
  const step = x => {
    const dist = +x.dist_m || 0, min = +x.min || (dist ? dist / 100 * 2 : 5);
    const lbl = String(x.label || 'bloc').replace(/[\n-]/g, ' ').slice(0, 60);
    const it = ['warmup', 'cooldown', 'interval', 'recovery'].includes(x.intensity) ? ' intensity=' + x.intensity : '';
    return B(String(x.label || ''), +min.toFixed(2), String(x.cible || ''), `- ${lbl} ${dist ? dist + 'mtr' : icuMin(Math.round(min * 12) / 12)}${tgt(x)}${it}`, Object.assign(dist ? { dist } : {}, x.intensity === 'warmup' ? { role: 'wu' } : x.intensity === 'cooldown' ? { role: 'cd' } : {}));
  };
  const steps = (o.blocs || []).map(b => (+b.repeat || 1) > 1 || (b.steps || []).length > 1 ? R(Math.max(1, +b.repeat || 1), (b.steps || []).map(step)) : step((b.steps || [])[0] || {}));
  const s = repack({ sport: o.sport, type: o.type || 'facile', titre: o.titre, intensite: o.intensite || '', steps, icuType: { run: 'Run', bike: 'Ride', swim: 'Swim' }[o.sport] || null, dur: o.type === 'qualite', conseil: o.conseil || '' });
  if (!s.icuType) s.icu = null;
  return s;
}

/** Fichier .zwo (Zwift, MyWhoosh, TrainerRoad…) pour une séance vélo. */
export function toZwo(s) {
  const pct = icu => { const m = String(icu || '').match(/(\d+)-(\d+)%(?! HR| Pace)/) || String(icu || '').match(/(\d+)%(?! HR| Pace)/); return m ? [m[1] / 100, (m[2] || m[1]) / 100] : [0.6, 0.6]; };
  const sec = st => Math.max(5, Math.round(st.min * 60));
  const one = st => { const [a, b] = pct(st.icu); return st.role === 'wu' ? `<Warmup Duration="${sec(st)}" PowerLow="${a}" PowerHigh="${b}"/>` : st.role === 'cd' ? `<Cooldown Duration="${sec(st)}" PowerLow="${b}" PowerHigh="${a}"/>` : `<SteadyState Duration="${sec(st)}" Power="${((a + b) / 2).toFixed(2)}"/>`; };
  const body = s.steps.filter(st => st.repeat || st.icu).map(st => {
    if (!st.repeat) return one(st);
    if (st.steps.length === 2) { const [on, off] = st.steps; return `<IntervalsT Repeat="${st.repeat}" OnDuration="${sec(on)}" OffDuration="${sec(off)}" OnPower="${(pct(on.icu).reduce((x, y) => x + y) / 2).toFixed(2)}" OffPower="${(pct(off.icu).reduce((x, y) => x + y) / 2).toFixed(2)}"/>`; }
    return Array(st.repeat).fill(st.steps.map(one).join('\n    ')).join('\n    ');
  }).join('\n    ');
  const x = t => String(t).replace(/[<&"]/g, c => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<workout_file>\n  <author>Mon Coach</author>\n  <name>${x(s.titre)}</name>\n  <description>${x(s.detail || '')}</description>\n  <sportType>bike</sportType>\n  <workout>\n    ${body}\n  </workout>\n</workout_file>\n`;
}
