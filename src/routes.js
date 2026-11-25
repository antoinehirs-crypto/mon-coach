// Parcours de course gratuits, calculés sur OpenStreetMap :
// - BRouter (brouter.de) pour les boucles depuis le domicile, avec le dénivelé ;
// - Overpass pour trouver une piste d'athlétisme proche ;
// - Nominatim pour retrouver une adresse.
const BR = 'https://brouter.de/brouter';
const R_EARTH = 6371000;

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export function dist(a, b) { // [lon, lat] -> mètres
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(x));
}
function dest([lon, lat], brg, m) {
  const d = m / R_EARTH, b = rad(brg), f1 = rad(lat), l1 = rad(lon);
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [deg(l2), deg(f2)];
}

export async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=' + encodeURIComponent(q));
  const j = await r.json();
  if (!j.length) throw new Error('adresse introuvable');
  return { lat: +(+j[0].lat).toFixed(5), lon: +(+j[0].lon).toFixed(5), label: j[0].display_name.split(',').slice(0, 3).join(',') };
}

async function brouter(points, profile) {
  const u = `${BR}?lonlats=${points.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join('|')}&profile=${profile}&alternativeidx=0&format=geojson`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('calcul du parcours impossible (' + r.status + ')');
  const j = await r.json(), f = j.features[0];
  return { coords: f.geometry.coordinates, km: +f.properties['track-length'] / 1000, dplus: +f.properties['filtered ascend'] || 0 };
}

const PROFILE = { route: 'shortest', nature: 'hiking-mountain', vallonne: 'hiking-mountain', trail: 'hiking-mountain', cotes: 'hiking-mountain', plat: 'shortest' };

/** Boucle d'environ `km` km qui part et revient au domicile. */
export async function loop(home, km, terrain = 'route', seed = 0) {
  const h = [home.lon, home.lat], profile = PROFILE[terrain] || 'shortest';
  const one = async brg => {
    let R = km * 1000 / (2 * Math.PI) * 0.78, best = null;
    for (let i = 0; i < 3; i++) {
      const c = dest(h, brg, R), pts = [h, ...[-100, -10, 80].map(a => dest(c, brg + 180 + a, R)), h];
      const r = await brouter(pts, profile);
      if (!best || Math.abs(r.km - km) < Math.abs(best.km - km)) best = r;
      if (Math.abs(r.km - km) / km < 0.08) break;
      R *= km / r.km;
    }
    return Object.assign(best, { brg });
  };
  const base = (seed * 97) % 360;
  const want = terrain === 'vallonne' || terrain === 'cotes' || terrain === 'trail' ? 2 : 1;
  const cands = [];
  for (let k = 0; k < want; k++) { try { cands.push(await one(base + k * 140)); } catch (e) { if (!cands.length && k === want - 1) throw e; } }
  if (!cands.length) throw new Error('aucun parcours trouvé');
  cands.sort((a, b) => (terrain === 'plat' || terrain === 'route' ? a.dplus / a.km - b.dplus / b.km : b.dplus / b.km - a.dplus / a.km));
  const r = cands[0];
  r.cote = steepest(r.coords);
  return r;
}

/** Portion la plus raide (environ 200 à 500 m) : pour les côtes. */
export function steepest(coords) {
  if (!coords.length || coords[0].length < 3) return null;
  const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  let best = null;
  for (let i = 0, j = 0; i < coords.length; i++) {
    while (j < coords.length - 1 && cum[j] - cum[i] < 300) j++;
    const len = cum[j] - cum[i]; if (len < 150) break;
    const gain = coords[j][2] - coords[i][2], pct = gain / len * 100;
    if (!best || pct > best.pct) best = { i, j, pct, len, gain, km: cum[i] / 1000 };
  }
  return best && best.pct >= 2.5 ? { at: coords[best.i], km: +best.km.toFixed(1), pente: +best.pct.toFixed(1), long: Math.round(best.len), gain: Math.round(best.gain), seg: coords.slice(best.i, best.j + 1) } : null;
}

/** Piste d'athlétisme la plus proche (6 km) et l'aller-retour depuis le domicile. */
async function tracksOverpass(home) {
  const q = `[out:json][timeout:12];way["leisure"="track"](around:6000,${home.lat},${home.lon});out center tags;`;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 9000);
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ac.signal }); clearTimeout(t);
      if (!r.ok) continue;
      return (await r.json()).elements.filter(e => e.center && (!e.tags?.sport || /athletics|running/.test(e.tags.sport))).map(e => ({ nom: e.tags?.name, p: [e.center.lon, e.center.lat] }));
    } catch (e) { /* serveur suivant */ }
  }
  return null;
}
async function tracksNominatim(home) {
  const vb = [home.lon - 0.08, home.lat + 0.055, home.lon + 0.08, home.lat - 0.055].join(',');
  const out = [];
  for (const q of ["piste d'athlétisme", 'stade']) {
    const j = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=15&bounded=1&viewbox=${vb}&q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => []);
    j.filter(x => x.class === 'leisure' && x.type === 'track').forEach(x => out.push({ nom: x.name, p: [+x.lon, +x.lat] }));
  }
  return out;
}
export async function trackRoute(home) {
  const h = [home.lon, home.lat];
  let els = await tracksOverpass(home);
  if (!els || !els.length) els = await tracksNominatim(home);
  if (!els.length) throw new Error('pas de piste d\'athlétisme trouvée à moins de 6 km');
  els.sort((a, b) => dist(h, a.p) - dist(h, b.p));
  const t = els[0];
  const go = await brouter([h, t.p], 'shortest');
  return { nom: t.nom && !/^piste d.athl/i.test(t.nom) ? t.nom : 'Piste d\'athlétisme', point: t.p, coords: go.coords, km: go.km, dplus: go.dplus, allerRetour: true };
}

export function gpx(name, coords) {
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mon Coach" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(name)}</name></metadata>
<trk><name>${esc(name)}</name><type>running</type><trkseg>
${coords.map(c => `<trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${c[2] != null ? `<ele>${(+c[2]).toFixed(1)}</ele>` : ''}</trkpt>`).join('\n')}
</trkseg></trk></gpx>`;
}
