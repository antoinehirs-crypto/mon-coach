// Repères calculés automatiquement à partir de Strava (activités + profil) et de Health Connect / Apple Santé.
// Chaque repère : { v: texte affiché, src: 'strava' | 'calcul' | 'health', note: d'où ça vient }.
// Une valeur saisie à la main dans le profil reste prioritaire.

const p2 = n => String(n).padStart(2, '0');
const mmss = sec => Math.floor(sec / 60) + ':' + p2(Math.round(sec % 60) % 60);
const fdate = s => s ? new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
const isRun = t => /Run/.test(t || '') && !/Virtual/.test(t || '');
const isSwim = t => /Swim/.test(t || '');
// Distance équivalente sur une durée cible (loi de Riegel, exposant 1,06)
const riegel = (d, t, T) => d * Math.pow(T / t, 1 / 1.06);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export const AUTO_KEYS = [
  ['fcmax', 'FC max', 'bpm'], ['fcseuil', 'FC seuil', 'bpm'], ['fcrepos', 'FC repos', 'bpm'],
  ['seuil', 'Allure seuil course', 'min/km'], ['vma', 'VMA', 'km/h'], ['ftp', 'FTP vélo', 'W'],
  ['css', 'CSS natation', 'min/100 m'], ['poids', 'Poids', 'kg'], ['vo2max', 'VO2max', 'ml/kg/min'],
];

/**
 * @param acts     activités Strava (1 an) : sport_type, name, start_local, distance (m), moving_time (s), avg_speed, avg_hr, max_hr
 * @param athlete  profil Strava enregistré par strava-sync : weight, ftp, hr_zones…
 * @param health   lignes health_daily récentes (resting_hr…), plus récentes d'abord
 * @param hextra   { weight, weight_at, vo2max, vo2max_at } lus dans Health Connect
 */
export function computeAuto({ acts = [], athlete = null, health = [], hextra = null }) {
  const R = {};

  // FC max : la plus haute mesurée sur 1 an, en écartant un pic isolé (capteur optique)
  const mx = acts.filter(a => a.max_hr && a.max_hr > 120 && a.max_hr < 225).sort((a, b) => b.max_hr - a.max_hr);
  if (mx.length) {
    const best = mx[1] && mx[0].max_hr - mx[1].max_hr > 8 ? mx[1] : mx[0];
    R.fcmax = { v: String(Math.round(best.max_hr)), n: Math.round(best.max_hr), src: 'strava', note: `mesurée : ${best.name || 'séance'} (${fdate(best.start_local)})` };
  }

  // Course : meilleur effort ramené à 1 h → allure seuil ; VMA ≈ vitesse seuil / 0,85
  const runs = acts.filter(a => isRun(a.sport_type) && a.distance >= 3000 && a.moving_time >= 720 && a.moving_time <= 4 * 3600 && a.avg_speed > 1.5 && a.avg_speed < 6.5);
  if (runs.length) {
    let best = null, d60 = 0;
    runs.forEach(a => { const d = riegel(a.distance, a.moving_time / 60, 60); if (d > d60) { d60 = d; best = a; } });
    const pace = 3600 / (d60 / 1000);
    R.seuil = { v: mmss(pace), n: pace, src: 'calcul', note: `estimée depuis ${best.name || 'ta meilleure course'} (${fdate(best.start_local)}, ${(best.distance / 1000).toFixed(1)} km en ${Math.floor(best.moving_time / 3600) ? Math.floor(best.moving_time / 3600) + 'h' + p2(Math.floor(best.moving_time % 3600 / 60)) : mmss(best.moving_time)})` };
    const vma = d60 / 1000 / 0.85;
    R.vma = { v: vma.toFixed(1), n: vma, src: 'calcul', note: 'estimée : vitesse seuil / 0,85 (à confirmer par un test VMA)' };
    // FC seuil : FC moyenne la plus haute sur une course de 30 à 90 min
    const hr = runs.filter(a => a.avg_hr && a.moving_time >= 1800 && a.moving_time <= 5400).sort((a, b) => b.avg_hr - a.avg_hr)[0];
    if (hr) R.fcseuil = { v: String(Math.round(hr.avg_hr)), n: Math.round(hr.avg_hr), src: 'calcul', note: `estimée : FC moyenne de ${hr.name || 'ton effort le plus dur'} (${fdate(hr.start_local)})` };
  }

  // FTP : celle de ton profil Strava
  if (athlete?.ftp) R.ftp = { v: String(athlete.ftp), n: athlete.ftp, src: 'strava', note: 'profil Strava' };

  // Natation : meilleur effort ramené à 30 min → CSS
  const swims = acts.filter(a => isSwim(a.sport_type) && a.distance >= 400 && a.moving_time >= 480 && a.avg_speed > 0.4 && a.avg_speed < 2.2);
  if (swims.length) {
    let best = null, d30 = 0;
    swims.forEach(a => { const d = riegel(a.distance, a.moving_time / 60, 30); if (d > d30) { d30 = d; best = a; } });
    const p100 = 1800 / (d30 / 100);
    R.css = { v: mmss(p100), n: p100, src: 'calcul', note: `estimée depuis ${best.name || 'ta meilleure séance'} (${fdate(best.start_local)}, ${Math.round(best.distance)} m)${swims.length < 3 ? ' : peu de séances, à affiner' : ''}` };
  }

  // FC repos : médiane des 7 derniers jours (montre → Health Connect / Apple Santé)
  const rhr = health.filter(h => h.resting_hr).slice(0, 7).map(h => h.resting_hr);
  if (rhr.length) R.fcrepos = { v: String(Math.round(median(rhr))), n: Math.round(median(rhr)), src: 'health', note: `médiane des ${rhr.length} derniers jours` };

  // Poids : balance / montre via Health Connect, sinon profil Strava
  if (hextra?.weight) R.poids = { v: (Math.round(hextra.weight * 10) / 10).toString(), n: hextra.weight, src: 'health', note: 'Health Connect' + (hextra.weight_at ? ', ' + fdate(hextra.weight_at) : '') };
  else if (athlete?.weight) R.poids = { v: (Math.round(athlete.weight * 10) / 10).toString(), n: athlete.weight, src: 'strava', note: 'profil Strava' };

  if (hextra?.vo2max) R.vo2max = { v: String(Math.round(hextra.vo2max)), n: hextra.vo2max, src: 'health', note: 'Health Connect' + (hextra.vo2max_at ? ', ' + fdate(hextra.vo2max_at) : '') };

  return R;
}

export const SRC_LABEL = { strava: 'Strava', calcul: 'Calculé', health: 'Montre', manuel: 'Saisi' };
