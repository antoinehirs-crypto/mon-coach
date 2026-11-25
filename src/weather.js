// Météo gratuite, sans clé : Open-Meteo (https://open-meteo.com). Cache local 1 h.
const DEF = { lat: 48.8049, lon: 2.1204, nom: 'Versailles' };
const CODES = { 0: 'ciel clair', 1: 'peu nuageux', 2: 'nuageux', 3: 'couvert', 45: 'brouillard', 48: 'brouillard givrant', 51: 'bruine', 53: 'bruine', 55: 'bruine forte', 61: 'pluie faible', 63: 'pluie', 65: 'forte pluie', 66: 'pluie verglaçante', 67: 'pluie verglaçante', 71: 'neige faible', 73: 'neige', 75: 'forte neige', 77: 'grésil', 80: 'averses', 81: 'averses', 82: 'fortes averses', 85: 'averses de neige', 86: 'averses de neige', 95: 'orage', 96: 'orage avec grêle', 99: 'orage avec grêle' };

export async function getWeather(geo) {
  const g = geo && geo.lat ? geo : DEF;
  const ck = 'mc_meteo_' + g.lat.toFixed(2) + '_' + g.lon.toFixed(2);
  try { const c = JSON.parse(localStorage.getItem(ck)); if (c && Date.now() - c.at < 36e5) return c.w; } catch (e) { }
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code&daily=sunrise,sunset&timezone=Europe%2FParis&forecast_days=3`;
  const r = await fetch(u); if (!r.ok) throw new Error('météo indisponible');
  const j = await r.json();
  const w = { nom: g.nom || 'ta position', hours: j.hourly.time.map((t, i) => ({ t, temp: j.hourly.temperature_2m[i], ress: j.hourly.apparent_temperature[i], pp: j.hourly.precipitation_probability[i] ?? 0, mm: j.hourly.precipitation[i] ?? 0, vent: j.hourly.wind_speed_10m[i], code: j.hourly.weather_code[i] })), days: j.daily.time.map((d, i) => ({ d, lever: j.daily.sunrise[i], coucher: j.daily.sunset[i] })) };
  try { localStorage.setItem(ck, JSON.stringify({ at: Date.now(), w })); } catch (e) { }
  return w;
}

/** Résumé météo sur une plage horaire (dkey "2026-11-25", minutes début/fin). */
export function weatherFor(w, dk, m0, m1) {
  if (!w) return null;
  const hs = w.hours.filter(h => h.t.slice(0, 10) === dk && (() => { const m = +h.t.slice(11, 13) * 60; return m >= Math.floor(m0 / 60) * 60 && m < m1; })());
  if (!hs.length) return null;
  const mx = k => Math.max(...hs.map(h => h[k])), mn = k => Math.min(...hs.map(h => h[k]));
  const worst = hs.reduce((a, h) => (h.code > a.code ? h : a), hs[0]);
  const day = w.days.find(d => d.d === dk);
  const toM = s => s ? +s.slice(11, 13) * 60 + +s.slice(14, 16) : null;
  const pp = mx('pp'), mm = hs.reduce((t, h) => t + h.mm, 0), vent = mx('vent'), tmin = mn('temp'), tmax = mx('temp'), ress = mn('ress');
  const nuit = day ? (m1 > toM(day.coucher) + 15 || m0 < toM(day.lever) - 15) : false;
  const pluie = pp >= 55 || mm >= 1;
  return {
    pp, mm: Math.round(mm * 10) / 10, vent: Math.round(vent), tmin: Math.round(tmin), tmax: Math.round(tmax), ress: Math.round(ress), ciel: CODES[worst.code] || '', nuit, pluie,
    okRun: !pluie || mm < 3, okBike: !pluie && pp < 40 && vent < 40 && tmin > 2 && !nuit,
    txt: `${Math.round(tmin)}${tmax !== tmin ? '-' + Math.round(tmax) : ''}°C, ${CODES[worst.code] || ''}${pp >= 20 ? ' (risque ' + pp + ' %)' : ''}${vent >= 25 ? ', vent ' + Math.round(vent) + ' km/h' : ''}${nuit ? ', de nuit' : ''}`,
  };
}
