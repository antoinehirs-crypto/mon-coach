import { sb, fn, configured } from './supa.js';
import { parseICS, EXAM } from './ics.js';
import { buildPlan, DAYS, tmin } from './planner.js';
import { isNative, healthAvailable, connectHealth, syncHealth, openHealthSettings } from './health.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const APP_URL = location.origin + location.pathname;
const APK_URL = import.meta.env.VITE_APK_URL || '';
const FN_BASE = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/health-ingest';
const SPORTS = ['Course à pied', 'Trail', 'Triathlon', 'Vélo route', 'VTT / Gravel', 'Natation', 'Musculation', 'CrossFit / Hyrox', 'Football', 'Basket', 'Rugby', 'Handball', 'Volley', 'Tennis / Padel', 'Badminton', 'Escalade', 'Ski / Ski de fond', 'Aviron', 'Boxe / Combat', 'Danse', 'Randonnée / Marche', 'Autre'];
document.querySelectorAll('[data-topo]').forEach(el => el.replaceWith($('#topoTpl').content.cloneNode(true)));

let S = { profile: null, plan: null, checkin: null, agenda: null, cal: null, slots: null, conf: null, hist: null, sources: null };
let user = null, me = null, data = null, health = [], strava = null, isAdmin = false, chat = [];

/* ---------- dates ---------- */
const p2 = n => String(n).padStart(2, '0');
const dkey = d => { d = new Date(d); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const today = () => dkey(new Date());
const hm = d => { d = new Date(d); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
function monday(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ago = t => { if (!t) return null; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'à l\'instant' : m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' j'; };
const fmtH = h => Math.floor(h) + 'h' + p2(Math.round(h % 1 * 60));

/* ---------- stockage : Supabase (privé, RLS) + cache local ---------- */
const local = { get(k) { try { return JSON.parse(localStorage.getItem('mc_' + (user?.id || '') + '_' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('mc_' + (user?.id || '') + '_' + k, JSON.stringify(v)); } catch (e) { } } };
async function loadAll() {
  for (const k of Object.keys(S)) S[k] = local.get(k);
  const { data: rows } = await sb.from('kv').select('key,value');
  (rows || []).forEach(r => { if (r.key in S) { S[r.key] = r.value; local.set(r.key, r.value); } });
}
const pending = {};
async function save(k, v) {
  S[k] = v; local.set(k, v);
  clearTimeout(pending[k]);
  pending[k] = setTimeout(() => sb.from('kv').upsert({ user_id: user.id, key: k, value: v, updated_at: new Date().toISOString() }).then(({ error }) => { if (error) console.warn(error); }), 300);
}

/* ---------- navigation ---------- */
const VIEWS = ['aujourdhui', 'semaine', 'agenda', 'coach', 'profil', 'admin'];
function route() {
  const h = (location.hash || '').slice(1); const id = VIEWS.includes(h) && (h !== 'admin' || isAdmin) ? h : 'aujourdhui';
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + id));
  document.querySelectorAll('#tabs a').forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + id));
  if (id === 'admin') loadAdmin();
  if (id === 'agenda' && user) drawAgendaCal();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ---------- agenda : liens iCal, contraintes manuelles ---------- */
async function syncCalendars(silent) {
  const urls = (S.sources?.ics || []);
  if (!urls.length) return;
  const all = [], errs = [];
  for (const u of urls) {
    try { const r = await fn('calendar-fetch', { body: { url: u.url } }); all.push(...parseICS(r.ics, u.id)); }
    catch (e) { errs.push((u.name || 'Agenda') + ' : ' + e.message); }
  }
  await save('cal', { evs: all, at: Date.now(), errs });
  if (!silent) toast(errs.length ? errs.join(' · ') : all.length + ' événements lus.');
}
function allEvents() {
  const a = S.agenda || {}, seen = new Set();
  return [...(a.manual || []), ...((S.cal && S.cal.evs) || [])].filter(e => { const k = e.s + '|' + e.t; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.s - y.s);
}
const evsOn = (d, L) => { const k = dkey(d); return (L || allEvents()).filter(e => dkey(e.s) === k); };
function dayInfo(d, L) {
  const ev = evsOn(d, L), busy = ev.filter(e => !e.allDay).reduce((t, e) => t + (e.e - e.s) / 36e5, 0);
  const ex = ev.filter(e => e.x).map(e => e.t), exNext = evsOn(addD(d, 1), L).filter(e => e.x).map(e => e.t);
  const timed = ev.filter(e => !e.allDay);
  return { jour: DAYS[(new Date(d).getDay() + 6) % 7], date: dkey(d), occupe: timed.length ? hm(timed[0].s) + '-' + hm(Math.max(...timed.map(e => e.e))) + ' (' + busy.toFixed(1) + ' h)' : 'libre', charge: busy >= 6.5 ? 'chargée' : busy >= 3.5 ? 'moyenne' : 'légère', examens: ex, veille_examen: exNext, ev };
}
function evRow(e) { return `<div class="ev${e.x ? ' exam' : ''}"><time>${e.allDay ? 'Journée' : hm(e.s) + '–' + hm(e.e)}</time><span>${esc(e.t)}${e.m === 'visio' ? ' <span class="small mut">(visio)</span>' : ''}${e.src === 'manual' ? ` <button class="btn sm" data-del="${esc(e.id)}" style="min-height:30px;padding:2px 10px;margin-left:6px">Retirer</button>` : ''}</span></div>`; }
function drawAgendaList() {
  const L = allEvents(), nx = L.filter(e => e.x && e.s > Date.now()).slice(0, 8), man = (S.agenda?.manual || []).filter(e => e.s > Date.now() - 864e5);
  let h = '';
  if (nx.length) h += `<div class="card"><h3>Examens et échéances à venir</h3>${nx.map(e => `<div class="ev exam"><time>${new Date(e.s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</time><span>${esc(e.t)}</span></div>`).join('')}</div>`;
  if (man.length) h += `<div class="card"><h3>Contraintes saisies</h3>${man.map(e => `<div class="ev${e.x ? ' exam' : ''}"><time>${new Date(e.s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</time><span>${esc(e.t)} <button class="btn sm" data-del="${esc(e.id)}" style="min-height:30px;padding:2px 10px;margin-left:6px">Retirer</button></span></div>`).join('')}</div>`;
  $('#agList').innerHTML = h;
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const a = Object.assign({}, S.agenda); a.manual = (a.manual || []).filter(e => String(e.id) !== b.dataset.del); await save('agenda', a); renderAll(); });
}
$('#ctAdd').onclick = async () => {
  const d = $('#ctDate').value, t = $('#ctTitle').value.trim(); if (!d || !t) { toast('Indique une date et un intitulé.'); return; }
  const a = Object.assign({ manual: [] }, S.agenda || {}); const s = new Date(d + 'T08:00').getTime();
  a.manual = (a.manual || []).concat({ s, e: s + 36e5, t, x: $('#ctExam').checked || EXAM.test(t), src: 'manual', allDay: 1, id: Date.now() });
  await save('agenda', a); $('#ctTitle').value = ''; $('#ctExam').checked = false; renderAll();
};

/* ---------- Strava ---------- */
const grp = t => /Swim/.test(t) ? 'swim' : /Ride|Bike|Cycl/.test(t) ? 'bike' : /Run|Trail/.test(t) ? 'run' : 'oth';
async function loadActivities() {
  const start = addD(monday(new Date()), -42);
  const { data: acts } = await sb.from('activities').select('*').gte('start_date', start.toISOString()).order('start_date', { ascending: false }).limit(400);
  if (!acts || !acts.length) { data = null; return; }
  const weeks = {}, daily = {};
  acts.forEach(a => {
    const dk = (a.start_local || '').slice(0, 10), w = dkey(monday(new Date(dk + 'T12:00'))), g = grp(a.sport_type || '');
    weeks[w] = weeks[w] || { swim: 0, bike: 0, run: 0, oth: 0, n: 0 }; weeks[w][g] += (a.moving_time || 0) / 3600; weeks[w].n++;
    // charge estimée : effort relatif Strava si dispo, sinon durée × intensité (FC moyenne)
    const ld = a.suffer_score != null ? a.suffer_score : Math.round((a.moving_time || 0) / 60 * (a.avg_hr ? Math.max(.5, Math.min(1.6, (a.avg_hr - 100) / 50)) : .8));
    daily[dk] = daily[dk] || { load: 0, h: 0 }; daily[dk].load += ld; daily[dk].h += (a.moving_time || 0) / 3600;
  });
  const recent = acts.slice(0, 14).map(a => ({ date: a.start_local, sport: a.sport_type, nom: a.name, km: +((a.distance || 0) / 1000).toFixed(1), min: Math.round((a.moving_time || 0) / 60), fc: a.avg_hr, watts: a.avg_watts }));
  const a0 = acts[0];
  data = { weeks, daily, recent, n: acts.length, last: { nom: a0.name, sport: a0.sport_type, date: a0.start_local, km: (a0.distance || 0) / 1000, dplus: a0.elevation || 0, sec: a0.moving_time || 0, v: a0.avg_speed || 0, pr: a0.pr_count || 0 } };
}
async function stravaStatus() { try { strava = await fn('strava-connect', { method: 'GET' }); } catch (e) { strava = { connected: false, error: e.message }; } }
async function syncStrava(silent) {
  if (!strava?.connected) return;
  try { const r = await fn('strava-sync', { body: { days: 42 } }); await loadActivities(); await stravaStatus(); if (!silent) toast(r.count + ' activités lues sur Strava.'); }
  catch (e) { if (!silent) toast('Strava : ' + e.message); }
}
async function connectStrava() {
  try { const r = await fn('strava-connect', { method: 'GET', query: { action: 'url', redirect: APP_URL } }); location.href = r.url; }
  catch (e) { toast(e.code === 'strava_non_configure' ? 'Strava n\'est pas encore configuré côté serveur.' : 'Strava : ' + e.message); }
}
async function handleStravaReturn() {
  const q = new URLSearchParams(location.search);
  if (q.get('state') !== 'strava') return;
  const code = q.get('code'), err = q.get('error');
  history.replaceState(null, '', location.pathname + location.hash);
  if (err || !code) { toast('Connexion Strava annulée.'); return; }
  try { await fn('strava-connect', { body: { code } }); await stravaStatus(); toast('Strava connecté. Import des activités…'); await syncStrava(false); }
  catch (e) { toast('Strava : ' + e.message + (/echange_refuse/.test(e.message) ? ' Si tu n\'es pas le propriétaire, l\'appli Strava est peut-être encore limitée à 1 athlète.' : '')); }
}
$('#syncBtn').onclick = async () => { $('#syncBtn').disabled = true; await syncStrava(false); $('#syncBtn').disabled = false; renderAll(); };
function drawBars() {
  if (!data || !data.weeks) { $('#bars').innerHTML = `<p class="mut small">${strava?.connected ? 'Aucune activité sur 6 semaines.' : 'Connecte Strava (Sources ci-dessus).'}</p>`; $('#syncInfo').textContent = ''; return; }
  const ks = Object.keys(data.weeks).sort(), mx = Math.max(1, ...ks.map(k => { const w = data.weeks[k]; return w.swim + w.bike + w.run + w.oth; }));
  $('#bars').innerHTML = ks.map(k => { const w = data.weeks[k], t = w.swim + w.bike + w.run + w.oth, dt = new Date(k + 'T12:00'); return `<div class="wk"><span class="mut">${dt.getDate()}/${dt.getMonth() + 1}</span><div class="stackbar" style="width:${t / mx * 100}%">${['swim', 'bike', 'run', 'oth'].map(g => `<i style="width:${t ? w[g] / t * 100 : 0}%;background:var(--${g})"></i>`).join('')}</div><span style="text-align:right">${t.toFixed(1)} h</span></div>`; }).join('');
  $('#syncInfo').textContent = strava?.last_sync ? 'Dernière synchro Strava : ' + new Date(strava.last_sync).toLocaleString('fr-FR') : '';
}

/* ---------- charge ---------- */
function loadStats() {
  const d = data && data.daily; if (!d) return null;
  let atl = 0, ctl = 0; const ser = []; const t0 = addD(new Date(), -41);
  for (let i = 0; i < 42; i++) { const k = dkey(addD(t0, i)), l = (d[k] && d[k].load) || 0; atl += (l - atl) / 7; ctl += (l - ctl) / 42; ser.push(l); }
  let h7 = 0; for (let i = 0; i < 7; i++) { const k = dkey(addD(new Date(), -i)); h7 += (d[k] && d[k].h) || 0; }
  return { atl: Math.round(atl), ctl: Math.round(ctl), tsb: Math.round(ctl - atl), h7, ser };
}
function drawLoad() {
  const L = loadStats();
  if (!L) { $('#loadTiles').innerHTML = `<div style="grid-column:1/-1"><span class="small mut">Connecte Strava : Garmin, COROS ou Samsung y envoient tes séances, et l'appli les lit toute seule.</span></div>`; $('#spark').innerHTML = ''; $('#loadNote').textContent = ''; return; }
  const t = [['Volume 7 j', fmtH(L.h7), ''], ['Fatigue', L.atl, 'ATL'], ['Forme de fond', L.ctl, 'CTL'], ['Fraîcheur', (L.tsb > 0 ? '+' : '') + L.tsb, 'TSB']];
  $('#loadTiles').innerHTML = t.map(([l, v, u]) => `<div><span class="mono">${esc(l)}</span><span class="v">${esc(v)}${u ? `<small>${esc(u)}</small>` : ''}</span></div>`).join('');
  $('#loadNote').textContent = (L.tsb < -15 ? 'Fatigue élevée : garde des séances faciles.' : L.tsb > 10 ? 'Tu es frais : bon moment pour une séance clé ou une course.' : 'Charge équilibrée.') + ' Estimation à partir de l\'effort relatif Strava (ou de la FC) sur 42 jours.';
  const sv = $('#spark'), W = sv.clientWidth || 320, H = 56, mx = Math.max(1, ...L.ser), bw = W / L.ser.length;
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);
  sv.innerHTML = L.ser.map((v, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - v / mx * (H - 4)).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(v / mx * (H - 4)).toFixed(1)}" rx="1.5" fill="${i >= 35 ? 'var(--terra)' : 'var(--sage)'}" opacity="${v ? 1 : .25}"/>`).join('');
}
function drawLast() {
  const a = data && data.last; $('#lastCard').hidden = !a; if (!a) return;
  const dt = new Date(a.date); const run = /Run|Walk|Hike/.test(a.sport || '');
  $('#lastMeta').textContent = 'Dernière activité · ' + dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  $('#lastName').textContent = a.nom || a.sport; $('#lastPr').hidden = !a.pr;
  const pace = a.v ? (run ? (() => { const sk = 1000 / a.v; return Math.floor(sk / 60) + ':' + p2(Math.round(sk % 60)) + ' /km'; })() : /Swim/.test(a.sport) ? (() => { const sk = 100 / a.v; return Math.floor(sk / 60) + ':' + p2(Math.round(sk % 60)) + ' /100m'; })() : (a.v * 3.6).toFixed(1) + ' km/h') : '–';
  const t = [['Distance', a.km.toFixed(1), 'km'], ['Dénivelé', Math.round(a.dplus), 'm'], ['Durée', Math.floor(a.sec / 3600) + ':' + p2(Math.floor(a.sec % 3600 / 60)), ''], [run ? 'Allure' : 'Vitesse', pace, '']];
  $('#lastTiles').innerHTML = t.map(([l, v, u]) => `<div><span class="mono">${esc(l)}</span><span class="v">${esc(v)}${u ? `<small>${esc(u)}</small>` : ''}</span></div>`).join('');
}

/* ---------- sommeil / VFC ---------- */
async function loadHealth() {
  const { data: rows } = await sb.from('health_daily').select('*').gte('date', dkey(addD(new Date(), -30))).order('date', { ascending: false });
  health = rows || [];
}
const hToday = () => health.find(h => h.date === today()) || null;
function hrvBase() { const v = health.filter(h => h.hrv_ms && h.date !== today()).slice(0, 7).map(h => h.hrv_ms); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function drawHealth() {
  const h = hToday(), b = hrvBase(), last = health[0];
  $('#hlBadge').textContent = h ? (h.source === 'health_connect' ? 'Health Connect' : h.source === 'iphone' ? 'Apple Santé' : h.source || 'Auto') : 'Saisie';
  $('#hlBadge').className = 'badge ' + (h ? 'ok' : 'n');
  const sl = h?.sleep_min ?? (S.checkin?.date === today() && S.checkin.sommeil ? S.checkin.sommeil * 60 : null);
  const t = [['Sommeil', sl ? fmtH(sl / 60) : '–', ''], ['Profond + REM', h && (h.deep_min || h.rem_min) ? fmtH(((h.deep_min || 0) + (h.rem_min || 0)) / 60) : '–', ''], ['VFC', h?.hrv_ms ? Math.round(h.hrv_ms) : '–', h?.hrv_ms ? 'ms' : ''], ['FC repos', h?.resting_hr ? Math.round(h.resting_hr) : '–', h?.resting_hr ? 'bpm' : '']];
  $('#hlTiles').innerHTML = t.map(([l, v, u]) => `<div><span class="mono">${esc(l)}</span><span class="v">${esc(v)}${u ? `<small>${esc(u)}</small>` : ''}</span></div>`).join('');
  let note = '';
  if (h?.hrv_ms && b) { const d = (h.hrv_ms - b) / b * 100; note = `VFC ${d >= 0 ? '+' : ''}${Math.round(d)} % vs ta moyenne 7 j. ` + (d < -12 ? 'Récupération incomplète : allège aujourd\'hui.' : d > 8 ? 'Bien récupéré.' : 'Dans ta normale.'); }
  else if (!h) note = last ? 'Dernière donnée reçue le ' + new Date(last.date).toLocaleDateString('fr-FR') + '.' : 'Pas encore de données de sommeil automatiques : voir Profil → Sources. En attendant, le check-in suffit.';
  $('#hlNote').textContent = note;
}
async function nativeHealthSync(silent) {
  if (!isNative()) return;
  try {
    const av = await healthAvailable(); if (!av.available) { if (!silent) toast('Health Connect n\'est pas disponible sur ce téléphone.'); return; }
    if (!silent) await connectHealth();
    const n = await syncHealth(user.id); await loadHealth();
    if (!silent) toast(n ? n + ' jours de sommeil/VFC importés depuis Health Connect.' : 'Rien trouvé : vérifie que Samsung Health, Garmin Connect ou COROS partagent le sommeil avec Health Connect.');
  } catch (e) { if (!silent) toast('Health Connect : ' + e.message); }
}

/* ---------- check-in ---------- */
const CI = [['sommeil', 'Heures de sommeil', null], ['qualite', 'Qualité du sommeil', ['Très mauvaise', 'Excellente']], ['fatigue', 'Fatigue', ['Aucune', 'Épuisé']], ['courbatures', 'Courbatures', ['Aucune', 'Fortes']], ['stress', 'Charge cours / travail', ['Calme', 'Rush']], ['motivation', 'Motivation', ['Nulle', 'À fond']]];
function drawCheckin() {
  const c = (S.checkin && S.checkin.date === today()) ? S.checkin : {}, h = hToday();
  const autoSleep = h?.sleep_min ? Math.round(h.sleep_min / 30) / 2 : '';
  $('#checkin').innerHTML = CI.map(([k, l, o]) => o ? `<label>${esc(l)}</label><div class="scale">${[1, 2, 3, 4, 5].map(n => `<button class="chip" data-ci="${k}" data-n="${n}" aria-pressed="${c[k] == n}" aria-label="${esc(l)} ${n} sur 5">${n}</button>`).join('')}</div><div class="small mut row sp"><span>${esc(o[0])}</span><span>${esc(o[1])}</span></div>` : `<label for="ci_${k}">${esc(l)}${autoSleep && c[k] == null ? ' <span class="badge ok">auto</span>' : ''}</label><input id="ci_${k}" type="number" inputmode="decimal" step="0.5" min="0" max="14" value="${esc(c[k] ?? autoSleep)}">`).join('');
  $('#checkin').querySelectorAll('[data-ci]').forEach(b => b.onclick = () => { $('#checkin').querySelectorAll(`[data-ci="${b.dataset.ci}"]`).forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); });
}
function readiness() {
  const c = S.checkin && S.checkin.date === today() ? S.checkin : null, h = hToday();
  if (!c && !h) return null;
  const n = k => Number(c?.[k] || 3), sleepH = c?.sommeil ? +c.sommeil : h?.sleep_min ? h.sleep_min / 60 : 7;
  let r = Math.min(1, sleepH / 8) * 25 + (n('qualite') - 1) / 4 * 15 + (5 - n('fatigue')) / 4 * 25 + (5 - n('courbatures')) / 4 * 15 + (5 - n('stress')) / 4 * 10 + (n('motivation') - 1) / 4 * 10;
  const b = hrvBase(); if (h?.hrv_ms && b) r += Math.max(-12, Math.min(8, (h.hrv_ms - b) / b * 60));
  return Math.max(0, Math.min(100, Math.round(r)));
}
$('#ciSave').onclick = async () => {
  const c = { date: today(), sommeil: $('#ci_sommeil').value };
  $('#checkin').querySelectorAll('[aria-pressed=true]').forEach(b => c[b.dataset.ci] = Number(b.dataset.n));
  await save('checkin', c); const r = readiness();
  $('#ciMsg').textContent = 'Forme du jour : ' + r + '/100. ' + (r < 45 ? 'Journée à alléger : footing très facile ou repos.' : r < 70 ? 'Séance prévue, sans forcer.' : 'Feu vert pour la séance prévue.'); drawRing(); pushSummary();
};
function drawRing() {
  const r = readiness(), L = 2 * Math.PI * 48;
  $('#ringArc').setAttribute('stroke-dasharray', r == null ? `0 ${L}` : `${L * r / 100} ${L}`);
  $('#ringArc').setAttribute('stroke', r == null ? '#c2562b' : r >= 70 ? '#7fd1ae' : r >= 45 ? '#e8a33d' : '#c2562b');
  $('#ringTxt').textContent = r == null ? '–' : r;
}

/* ---------- semaine type + croisement avec les cours ---------- */
const HH = 40, H0 = 6, H1 = 23;
const KINDS = [['swim', 'Natation'], ['run', 'Course'], ['bike', 'Vélo'], ['renfo', 'Muscu / renfo'], ['club', 'Club / sport co'], ['autre', 'Autre engagement']];
const tstr = m => p2(Math.floor(m / 60)) + ':' + p2(m % 60);
const slots = () => S.slots || [];
const cleanT = t => t.replace(/^ESILV( \(en ligne\))? · /, '');
function slotStatus(sl, date, L) {
  const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
  const s = d0.getTime() + tmin(sl.s) * 6e4, e = d0.getTime() + tmin(sl.e) * 6e4;
  const ev = evsOn(d0, L).filter(x => !x.allDay && !/^(mon coach|séance)/i.test(x.t) && x.t.trim().toLowerCase() !== (sl.t || '').trim().toLowerCase());
  const te = +sl.te || 45, th = +sl.th || 15;
  const lab = x => cleanT(x.t) + (x.m === 'visio' ? ' (visio)' : '') + ' ' + hm(x.s) + '-' + hm(x.e);
  let st = 'oui', why = 'Aucun cours ne gêne.';
  const ov = ev.find(x => x.s < e && x.e > s);
  if (ov) { st = 'non'; why = 'Pendant : ' + lab(ov) + '.'; }
  else {
    const bef = ev.filter(x => x.e <= s).sort((a, b) => b.e - a.e)[0], aft = ev.filter(x => x.s >= e).sort((a, b) => a.s - b.s)[0];
    if (bef) {
      const gap = (s - bef.e) / 6e4;
      if (bef.m === 'visio') { if (gap < th) { st = 'maybe'; why = 'Cours en visio jusqu\'à ' + hm(bef.e) + ', il faut ~' + th + ' min depuis chez toi : à toi de voir.'; } }
      else if (gap < te - 15) { st = 'non'; why = 'Cours en présentiel jusqu\'à ' + hm(bef.e) + ' : il faut ~' + te + ' min de trajet, tu n\'as que ' + Math.max(0, Math.round(gap)) + ' min.'; }
      else if (gap < te) { st = 'maybe'; why = 'Juste : cours jusqu\'à ' + hm(bef.e) + ', ~' + te + ' min de trajet pour ' + Math.round(gap) + ' min dispo.'; }
    }
    if (st === 'oui' && aft) { const gap = (aft.s - e) / 6e4, need = aft.m === 'visio' ? th : te; if (gap < need) { st = 'maybe'; why = 'Cours ' + lab(aft) + ' juste après : ' + Math.round(gap) + ' min pour ~' + need + ' min de trajet.'; } }
  }
  const dd = dayInfo(d0, L);
  if (st !== 'non' && (dd.examens.length || dd.veille_examen.length) && sl.k !== 'autre') { if (st === 'oui') st = 'maybe'; why += (dd.examens.length ? ' Jour d\'examen' : ' Veille d\'examen') + ' : version facile seulement.'; }
  return { st, why, s, e };
}
function weekStatus(off) {
  const m = addD(monday(new Date()), 7 * off), wk = dkey(m), L = allEvents(), cf = (S.conf || {})[wk] || {};
  return slots().map(sl => {
    const date = addD(m, sl.d), r = slotStatus(sl, date, L), c = cf[sl.id];
    return Object.assign(r, { slot: sl, date: dkey(date), wk, conf: c, final: c === 'oui' ? 'confirmé' : c === 'non' ? 'annulé' : r.st === 'maybe' ? 'peut-être' : r.st });
  }).sort((a, b) => a.s - b.s);
}
let calView = 'type';
function drawCal(host, view) {
  const off = view === 'type' ? null : +view, m = addD(monday(new Date()), 7 * (off || 0)), L = allEvents(), td = dkey(new Date());
  const hours = []; for (let h = H0; h < H1; h++) hours.push(h);
  const ws = off == null ? null : weekStatus(off);
  let cols = '';
  for (let d = 0; d < 7; d++) {
    const date = addD(m, d); let inner = '';
    if (off != null) evsOn(date, L).filter(x => !x.allDay).forEach(x => {
      const a = new Date(x.s), b = new Date(x.e), t0 = Math.max(H0 * 60, a.getHours() * 60 + a.getMinutes()), t1 = Math.min(H1 * 60, b.getHours() * 60 + b.getMinutes()); if (t1 <= t0) return;
      inner += `<div class="blk evb${x.m === 'visio' ? ' visio' : ''}${x.x ? ' exam' : ''}" style="top:${(t0 - H0 * 60) / 60 * HH}px;height:${Math.max(16, (t1 - t0) / 60 * HH - 2)}px"><b>${esc(cleanT(x.t))}</b>${x.m === 'visio' ? 'visio' : ''}</div>`;
    });
    slots().filter(sl => sl.d === d).forEach(sl => {
      const t0 = tmin(sl.s), t1 = tmin(sl.e); const w = ws && ws.find(x => x.slot.id === sl.id);
      const cls = w ? (w.final === 'annulé' || w.final === 'non' ? ' non' : w.final === 'peut-être' ? ' maybe' : '') : '';
      inner += `<div class="blk slot ${esc(sl.k)}${cls}" data-sl="${esc(sl.id)}" style="top:${(t0 - H0 * 60) / 60 * HH}px;height:${Math.max(18, (t1 - t0) / 60 * HH - 2)}px;left:${off != null ? '40%' : '2px'}"><b>${esc(sl.t)}</b>${esc(sl.s)}</div>`;
    });
    if (off != null && dkey(date) === td) { const n = new Date(), mm = n.getHours() * 60 + n.getMinutes(); if (mm > H0 * 60 && mm < H1 * 60) inner += `<div class="nowl" style="top:${(mm - H0 * 60) / 60 * HH}px"></div>`; }
    cols += `<div class="cold" data-d="${d}" style="--hh:${HH}px;height:${(H1 - H0) * HH}px">${inner}</div>`;
  }
  const DL = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  host.innerHTML = `<div class="cal"><div class="calh"><div></div>${DL.map((x, i) => { const dt = addD(m, i); return `<div class="${off != null && dkey(dt) === td ? 'td' : ''}">${x}${off != null ? `<b>${dt.getDate()}</b>` : ''}</div>`; }).join('')}</div>
   <div class="calb"><div class="calg"><div class="calt" style="height:${(H1 - H0) * HH}px">${hours.map(h => `<span style="top:${(h - H0) * HH}px">${h}h</span>`).join('')}</div>${cols}</div></div></div>`;
  const body = host.querySelector('.calb'); body.scrollTop = (Math.min(16, Math.max(H0, (slots()[0] ? tmin(slots()[0].s) / 60 - 2 : 16))) - H0) * HH;
  host.querySelectorAll('.cold').forEach(c => c.addEventListener('click', e => {
    const sl = e.target.closest('[data-sl]'); if (sl) { editSlot(slots().find(x => x.id === sl.dataset.sl), host, view); return; }
    if (e.target.closest('.blk')) return;
    const r = c.getBoundingClientRect(), mm = H0 * 60 + Math.floor((e.clientY - r.top) / HH * 2) * 30;
    editSlot({ id: '', d: +c.dataset.d, s: tstr(mm), e: tstr(Math.min(H1 * 60, mm + 60)), t: '', k: 'swim', lieu: '', te: 45, th: 15 }, host, view);
  }));
}
function editSlot(sl, host, view) {
  const isNew = !sl.id;
  $('#dlgBody').innerHTML = `<h3>${isNew ? 'Nouveau créneau' : 'Modifier le créneau'}</h3>
   <label for="slT">Intitulé</label><input id="slT" value="${esc(sl.t)}" placeholder="Ex : Natation club">
   <label>Type</label><div class="chips" id="slK">${KINDS.map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${sl.k === k}">${l}</button>`).join('')}</div>
   <label>Jours</label><div class="chips" id="slD">${DAYS.map((d, i) => `<button class="chip" data-d="${i}" aria-pressed="${i === sl.d}">${d.slice(0, 3)}</button>`).join('')}</div>
   <div class="row" style="margin-top:4px"><div style="flex:1"><label for="slS">Début</label><input id="slS" type="time" step="900" value="${esc(sl.s)}"></div><div style="flex:1"><label for="slE">Fin</label><input id="slE" type="time" step="900" value="${esc(sl.e)}"></div></div>
   <label for="slL">Lieu</label><input id="slL" value="${esc(sl.lieu)}" placeholder="Ex : piscine de Viroflay">
   <div class="row"><div style="flex:1"><label for="slTe">Trajet depuis l'école</label><input id="slTe" type="number" inputmode="numeric" min="0" step="5" value="${esc(sl.te)}"></div><div style="flex:1"><label for="slTh">Depuis chez toi</label><input id="slTh" type="number" inputmode="numeric" min="0" step="5" value="${esc(sl.th)}"></div></div>
   <p class="small mut">En minutes. Cours en présentiel : trajet depuis l'école. Cours en visio : trajet depuis chez toi.</p>
   <p class="err" id="slErr"></p>
   <div class="row sp" style="margin-top:8px">${isNew ? '<span></span>' : '<button class="btn danger" id="slDel">Supprimer</button>'}<button class="btn pri" id="slOk">Enregistrer</button></div>`;
  $('#dlgBody').querySelectorAll('#slK .chip').forEach(c => c.onclick = () => { $('#dlgBody').querySelectorAll('#slK .chip').forEach(x => x.setAttribute('aria-pressed', 'false')); c.setAttribute('aria-pressed', 'true'); if (!$('#slT').value) $('#slT').placeholder = c.textContent; });
  $('#dlgBody').querySelectorAll('#slD .chip').forEach(c => c.onclick = () => { if (!isNew) $('#dlgBody').querySelectorAll('#slD .chip').forEach(x => x.setAttribute('aria-pressed', 'false')); c.setAttribute('aria-pressed', isNew ? String(c.getAttribute('aria-pressed') !== 'true') : 'true'); });
  $('#dlg').showModal();
  $('#slOk').onclick = async () => {
    const k = ($('#dlgBody .chip[data-k][aria-pressed=true]') || { dataset: { k: 'autre' } }).dataset.k, days = [...$('#dlgBody').querySelectorAll('#slD .chip[aria-pressed=true]')].map(c => +c.dataset.d);
    const s = $('#slS').value, e = $('#slE').value, t = $('#slT').value.trim() || (KINDS.find(x => x[0] === k) || [, 'Créneau'])[1];
    if (!days.length || !s || !e || tmin(e) <= tmin(s)) { $('#slErr').textContent = 'Choisis au moins un jour et une fin après le début.'; return; }
    const base = { t, k, s, e, lieu: $('#slL').value.trim(), te: +$('#slTe').value || 0, th: +$('#slTh').value || 0 };
    let L = slots().slice();
    if (isNew) days.forEach((d, i) => L.push(Object.assign({ id: Date.now().toString(36) + i, d }, base)));
    else L = L.map(x => x.id === sl.id ? Object.assign({}, x, base, { d: days[0] }) : x);
    await save('slots', L); $('#dlg').close(); drawCal(host, view); if (host.id === 'calBox') drawAgendaCal();
  };
  const del = $('#slDel'); if (del) del.onclick = async () => { await save('slots', slots().filter(x => x.id !== sl.id)); $('#dlg').close(); drawCal(host, view); if (host.id === 'calBox') drawAgendaCal(); };
}
const ST_LBL = { 'oui': ['Possible', 'ok'], 'confirmé': ['Confirmé', 'ok'], 'peut-être': ['Peut-être', 'n'], 'non': ['Impossible', ''], 'annulé': ['Annulé', ''] };
function drawAgendaCal() {
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.wk === calView));
  drawCal($('#calBox'), calView);
  $('#calLegend').textContent = calView === 'type' ? (slots().length ? slots().length + ' créneau(x) récurrent(s). Touche un créneau pour le modifier.' : 'Aucun créneau pour l\'instant : touche une case vide.') : 'En gris : tes cours (hachuré = visio). En couleur : tes créneaux. Barré = impossible, « ? » = peut-être, à confirmer ci-dessous.';
  const box = $('#stCard');
  if (calView === 'type' || !slots().length) { box.hidden = true; return; }
  box.hidden = false; const ws = weekStatus(+calView);
  $('#stTitle').textContent = (calView === '0' ? 'Cette semaine' : 'Semaine prochaine') + ' · ' + ws.filter(x => x.final === 'oui' || x.final === 'confirmé').length + ' sur ' + ws.length + ' faisables';
  $('#stList').innerHTML = ws.map(x => {
    const [l, c] = ST_LBL[x.final]; const d = new Date(x.s);
    return `<div class="st"><div><b>${esc(x.slot.t)}</b> <span class="small mut">${esc(DAYS[x.slot.d])} ${d.getDate()}/${d.getMonth() + 1} · ${esc(x.slot.s)}-${esc(x.slot.e)}</span></div><span class="badge ${c}">${l}</span><div class="why">${esc(x.why)}</div>
    ${x.st !== 'non' ? `<div class="row" style="grid-column:1/-1"><button class="btn sm${x.conf === 'oui' ? ' pri' : ''}" data-cf="oui" data-id="${esc(x.slot.id)}" data-wk="${esc(x.wk)}">J'y vais</button><button class="btn sm${x.conf === 'non' ? ' pri' : ''}" data-cf="non" data-id="${esc(x.slot.id)}" data-wk="${esc(x.wk)}">Je n'y vais pas</button></div>` : ''}</div>`;
  }).join('');
  $('#stList').querySelectorAll('[data-cf]').forEach(b => b.onclick = async () => { const c = Object.assign({}, S.conf || {}); const w = Object.assign({}, c[b.dataset.wk] || {}); if (w[b.dataset.id] === b.dataset.cf) delete w[b.dataset.id]; else w[b.dataset.id] = b.dataset.cf; c[b.dataset.wk] = w; await save('conf', c); drawAgendaCal(); drawToday(); });
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { calView = b.dataset.wk; drawAgendaCal(); });

/* ---------- plan ---------- */
const HARD = /seuil|vma|fraction|interval|z4|z5|tempo|intens|sprint|match|compét|sweet|lourd|css/i;
const planMin = p => (p.jours || []).reduce((t, j) => t + (j.seances || []).filter(s => s.sport !== 'repos').reduce((u, s) => u + (+s.duree_min || 0), 0), 0);
const doneMin = p => { let t = 0; (p.jours || []).forEach((j, i) => (j.seances || []).forEach((s, k) => { if (p.done && p.done[i + '_' + k]) t += (+s.duree_min || 0); })); return t; };
function loadRule() {
  const h = (S.hist || []).slice(-4), last = h[h.length - 1];
  let since = 0; for (let i = h.length - 1; i >= 0 && !h[i].allegee; i--) since++;
  const base = last ? (last.fait || last.prevu) : null;
  return { semaines_depuis_allegement: since, allegee_obligatoire: since >= 3, minutes_max: base ? Math.round(base * 1.1) : null, historique: h };
}
function ctx() {
  const m = monday(new Date()), L = allEvents();
  return {
    profil: S.profile, checkin_du_jour: S.checkin && S.checkin.date === today() ? S.checkin : null, forme_sur_100: readiness(), sommeil_vfc_7j: health.slice(0, 7),
    strava_6_semaines: data ? data.weeks : null, dernieres_seances: data ? data.recent : null,
    agenda_semaine: [...Array(8)].map((_, i) => { const x = dayInfo(addD(m, i), L); delete x.ev; return x; }),
    examens_a_venir: L.filter(e => e.x && e.s > Date.now()).slice(0, 8).map(e => ({ date: dkey(e.s), titre: e.t })),
    charge: loadRule(), creneaux_semaine_type: weekStatus(0).map(x => ({ jour: DAYS[x.slot.d], creneau: x.slot.t, horaire: x.slot.s + '-' + x.slot.e, statut: x.final, raison: x.why })), plan_actuel: S.plan,
  };
}
$('#genBtn').onclick = async () => {
  $('#genBtn').disabled = true; $('#genErr').textContent = '';
  try {
    await syncCalendars(true);
    const start = monday(new Date()), wk = dkey(start), L = allEvents();
    if (S.plan && S.plan.semaine && S.plan.semaine !== wk) { const h = (S.hist || []).filter(x => x.semaine !== S.plan.semaine); h.push({ semaine: S.plan.semaine, prevu: planMin(S.plan), fait: doneMin(S.plan), allegee: !!S.plan.allegee }); await save('hist', h.slice(-12)); }
    const days = [...Array(7)].map((_, i) => { const x = dayInfo(addD(start, i), L); delete x.ev; return x; });
    const fixed = weekStatus(0).map(x => ({ dayIndex: x.slot.d, slot: x.slot, final: x.final }));
    const p = buildPlan({ profile: S.profile || {}, days, fixed, rule: loadRule(), stravaWeeks: data?.weeks, readiness: readiness() });
    p.semaine = wk; p.done = {}; await save('plan', p); renderAll(); pushSummary();
  } catch (e) { $('#genErr').textContent = 'Impossible de générer le plan : ' + e.message; }
  $('#genBtn').disabled = false;
};
const dayOf = (p, i) => (p.jours || []).find(x => (x.jour || '').toLowerCase() === DAYS[i].toLowerCase()) || (p.jours || [])[i] || { seances: [] };
function sesCard(p, i, k, s, inf) {
  const id = i + '_' + k, dn = p.done && p.done[id], cls = ['swim', 'bike', 'run', 'renfo', 'repos'].includes(s.sport) ? s.sport : '';
  const risk = s.sport !== 'repos' && HARD.test((s.intensite || '') + ' ' + (s.titre || '')) && inf && (inf.examens.length || inf.veille_examen.length);
  return `<div class="ses ${cls}${dn ? ' done' : ''}" data-id="${id}" ${s.sport === 'repos' ? '' : 'tabindex="0" role="button"'}><b>${esc(s.titre || 'Repos')}</b><span class="small mut">${s.sport === 'repos' ? 'Repos / récupération' : esc(s.duree_min) + ' min · ' + esc(s.intensite)}</span>${risk ? '<span class="warn">Séance dure près d\'un examen : à alléger</span>' : ''}</div>`;
}
function drawPlan() {
  const p = S.plan, cur = dkey(monday(new Date()));
  $('#genBtn').textContent = p && p.semaine === cur ? 'Régénérer ma semaine' : 'Générer ma semaine';
  if (!p) { $('#week').innerHTML = ''; $('#kpis').innerHTML = ''; $('#planSum').textContent = 'Pas encore de plan. Ajoute ta semaine type et complète ton profil, puis génère ta semaine.'; $('#todaySes').innerHTML = '<p class="small mut">Pas encore de plan cette semaine. <a href="#semaine">Génère-le</a>.</p>'; $('#tips').hidden = true; return; }
  const old = p.semaine !== cur;
  $('#planTitle').textContent = old ? 'Semaine passée' : (p.titre || 'Ma semaine'); $('#planSum').textContent = (old ? 'Ce plan date de la semaine du ' + p.semaine + '. Génère la nouvelle. ' : '') + (p.resume || '');
  const pm = planMin(p), dm = doneMin(p), rp = Object.values(p.done || {}).map(d => +d.rpe).filter(Boolean);
  $('#kpis').innerHTML = `<div><span class="mono">Prévu</span><span class="v">${Math.floor(pm / 60)}h${p2(pm % 60)}</span></div><div><span class="mono">Fait</span><span class="v">${Math.floor(dm / 60)}h${p2(dm % 60)}</span></div><div><span class="mono">RPE moyen</span><span class="v">${rp.length ? (rp.reduce((a, b) => a + b, 0) / rp.length).toFixed(1) : '–'}</span></div>`;
  const L = allEvents(), start = new Date(p.semaine + 'T12:00'), td = dkey(new Date());
  $('#week').innerHTML = DAYS.map((d, i) => {
    const dt = addD(start, i), inf = dayInfo(dt, L), j = dayOf(p, i);
    return `<div class="day${dkey(dt) === td ? ' today' : ''}"><h4>${d} ${dt.getDate()}/${dt.getMonth() + 1}${inf.examens.length ? '<span class="tag ex">Examen</span>' : ''}${inf.veille_examen.length ? '<span class="tag ex">Veille d\'examen</span>' : ''}${inf.charge !== 'légère' ? `<span class="tag">Cours ${esc(inf.occupe)}</span>` : ''}</h4>${(j.seances || []).map((s, k) => sesCard(p, i, k, s, inf)).join('')}</div>`;
  }).join('');
  $('#tips').hidden = !(p.conseils || []).length; $('#tips').innerHTML = '<h3>Conseils</h3>' + (p.conseils || []).map(c => '• ' + esc(c)).join('<br>');
  const ti = (new Date().getDay() + 6) % 7;
  $('#todaySes').innerHTML = old ? '<p class="small mut">Nouvelle semaine : <a href="#semaine">génère ton plan</a>.</p>' : (dayOf(p, ti).seances || []).map((s, k) => sesCard(p, ti, k, s, dayInfo(new Date(), L))).join('') || '<p class="small mut">Rien de prévu.</p>';
  document.querySelectorAll('.ses[role=button]').forEach(el => { el.onclick = () => openSes(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter') openSes(el.dataset.id); }; });
}
function openSes(id) {
  const [i, k] = id.split('_').map(Number), p = S.plan, s = dayOf(p, i).seances[k], dn = (p.done || {})[id] || {};
  $('#dlgBody').innerHTML = `<h3>${esc(s.titre)}</h3><p class="mut small">${esc(DAYS[i])} · ${esc(s.duree_min)} min · ${esc(s.intensite)}</p><p style="white-space:pre-wrap">${esc(s.detail)}</p><p class="small mut">${esc(s.pourquoi)}</p>
  <label for="rpe">Ressenti (RPE 1 à 10)</label><input id="rpe" type="number" inputmode="numeric" min="1" max="10" value="${esc(dn.rpe || '')}"><label for="cm">Commentaire</label><textarea id="cm" rows="2">${esc(dn.cm || '')}</textarea>
  <div class="row" style="margin-top:12px"><button class="btn pri" id="doneBtn">${dn.ok ? 'Mettre à jour' : 'Séance faite'}</button>${dn.ok ? '<button class="btn" id="undoBtn">Pas faite</button>' : ''}</div>`;
  $('#dlg').showModal();
  $('#doneBtn').onclick = async () => { p.done = p.done || {}; p.done[id] = { ok: true, rpe: $('#rpe').value, cm: $('#cm').value }; await save('plan', p); $('#dlg').close(); renderAll(); pushSummary(); };
  const u = $('#undoBtn'); if (u) u.onclick = async () => { delete p.done[id]; await save('plan', p); $('#dlg').close(); renderAll(); };
}
$('#dlgClose').onclick = () => $('#dlg').close();

/* ---------- coach IA (facultatif) & bilan ---------- */
const RULES = `Règles : polarisé 80/20 ; +10 % de volume max par semaine ; semaine allégée toutes les 3-4 semaines ; rien de dur le jour ou la veille d'un examen ; séances chiffrées (échauffement, corps avec zones/allures/watts, retour au calme, durée) ; adapté au niveau ; jamais d'avis médical.`;
async function ai(prompt) { const r = await fn('coach-ai', { body: { prompt } }); return r.text; }
const SUG = ["J'ai un examen cette semaine, tu réorganises ?", "Je suis fatigué, je fais quoi ?", "Que manger avant ma course ?", "Propose-moi un test pour mes zones"];
$('#sugg').innerHTML = SUG.map(s => `<button class="chip">${esc(s)}</button>`).join('');
$('#sugg').querySelectorAll('.chip').forEach(c => c.onclick = () => { $('#q').value = c.textContent; $('#q').focus(); });
$('#askBtn').onclick = async () => {
  const q = $('#q').value.trim(); if (!q) return;
  const meEl = document.createElement('div'); meEl.className = 'msg me'; meEl.textContent = q;
  const box = document.createElement('div'); box.className = 'msg'; box.textContent = '…'; $('#ans').prepend(box); $('#ans').prepend(meEl); $('#q').value = ''; $('#askBtn').disabled = true;
  const hist = chat.slice(-4).map(c => 'Athlète : ' + c.q + '\nCoach : ' + c.a).join('\n');
  try { box.textContent = await ai(`Tu es l'entraîneur personnel de cet athlète (tous sports). Réponds en français, concret, chiffré, 150 mots max.\n${RULES}\nDonnées : ${JSON.stringify(ctx())}\n${hist ? 'Échange précédent :\n' + hist + '\n' : ''}Question : ${q}`); }
  catch (e) { box.textContent = e.code === 'ia_non_configuree' ? 'Le coach IA n\'est pas encore activé sur cette appli (clé Gemini gratuite à ajouter côté serveur). Le plan de la semaine fonctionne sans.' : 'Erreur : ' + e.message; }
  chat.push({ q, a: box.textContent }); $('#askBtn').disabled = false;
};
$('#bilanBtn').onclick = async () => {
  const p = S.plan; if (!p) { $('#bilan').innerHTML = '<p class="small mut">Génère d\'abord un plan.</p>'; return; }
  const pm = planMin(p), dm = doneMin(p), rp = Object.values(p.done || {}).map(d => +d.rpe).filter(Boolean), L = loadStats();
  const pct = pm ? Math.round(dm / pm * 100) : 0, rpe = rp.length ? rp.reduce((a, b) => a + b, 0) / rp.length : null;
  let txt = `Charge : ${dm} min faites sur ${pm} prévues (${pct} %).${L ? ` Strava : ${fmtH(L.h7)} sur 7 jours, fraîcheur ${L.tsb}.` : ''}\n\nRessentis : ${rpe ? 'RPE moyen ' + rpe.toFixed(1) + '/10.' : 'pas de RPE noté.'}${hrvBase() ? ' VFC moyenne ' + Math.round(hrvBase()) + ' ms.' : ''}\n\nAjustements : ` +
    (pct < 70 ? 'semaine incomplète, on reconduit le même volume la semaine prochaine plutôt que d\'augmenter.' : rpe && rpe > 7 ? 'semaine faite mais dure : on garde le volume et on vérifie que les séances faciles restent faciles.' : loadRule().allegee_obligatoire ? 'semaine allégée la prochaine fois (3 semaines de charge enchaînées).' : 'bien joué, +5 à +10 % de volume possible la semaine prochaine.');
  $('#bilan').innerHTML = `<div class="msg">${esc(txt)}</div>`;
  $('#bilanBtn').disabled = true;
  try { const t = await ai(`Fais le bilan de la semaine de cet athlète en français, 180 mots max, 3 titres courts : Charge, Progrès et ressentis, Ajustements.\n${RULES}\nPrévu ${pm} min, fait ${dm} min.\nDonnées : ${JSON.stringify(ctx())}`); $('#bilan').innerHTML = `<div class="msg">${esc(t)}</div>`; } catch (e) { }
  $('#bilanBtn').disabled = false;
};

/* ---------- profil ---------- */
const PFIELDS = [
  ['niveau', 'Niveau', 'select', ['', 'Débutant', 'Intermédiaire', 'Confirmé', 'Compétiteur', 'Élite']],
  ['objectif', 'Objectif principal', 'text', 'Ex : 10 km d\'Issy en 40 min'], ['date', 'Date de l\'objectif', 'date'], ['chrono', 'Objectif chiffré', 'text', 'Chrono, classement…'],
  ['heures', 'Heures dispo par semaine', 'number'],
];
const REFS = [['fcmax', 'FC max', 'bpm'], ['fcrepos', 'FC repos', 'bpm'], ['seuil', 'Allure seuil course', 'min/km'], ['vma', 'VMA', 'km/h'], ['ftp', 'FTP vélo', 'W'], ['css', 'CSS natation', 'min/100 m']];
function editProfile() {
  const p = S.profile || {}, r = p.refs || {};
  $('#dlgBody').innerHTML = `<h3>Mon profil</h3><p class="small mut">Tout est facultatif, mais plus c'est rempli, plus le plan est précis.</p>
   <label for="pfN">Prénom</label><input id="pfN" value="${esc(p.prenom)}">
   <label>Sports</label><div class="chips" id="pfS">${SPORTS.map(x => `<button class="chip" data-o="${esc(x)}" aria-pressed="${(p.sports || []).includes(x)}">${esc(x)}</button>`).join('')}</div>
   ${PFIELDS.map(([k, l, t, o]) => `<label for="pf_${k}">${l}</label>` + (t === 'select' ? `<select id="pf_${k}">${o.map(x => `<option ${p[k] === x ? 'selected' : ''}>${x}</option>`).join('')}</select>` : `<input id="pf_${k}" type="${t}" value="${esc(p[k])}" ${o ? `placeholder="${esc(o)}"` : ''} ${t === 'number' ? 'inputmode="decimal" step="0.5"' : ''}>`)).join('')}
   <label>Jours possibles</label><div class="chips" id="pfJ">${DAYS.map(d => `<button class="chip" data-o="${d}" aria-pressed="${!(p.jours && p.jours.length) || p.jours.includes(d)}">${d.slice(0, 3)}</button>`).join('')}</div>
   <h3 style="margin-top:18px">Repères</h3>${REFS.map(([k, l, u]) => `<label for="rf_${k}">${l} <span class="mut" style="font-weight:400">(${u})</span></label><input id="rf_${k}" value="${esc(r[k])}">`).join('')}
   <label for="pf_bl">Blessures ou douleurs</label><textarea id="pf_bl" rows="2">${esc(p.blessures)}</textarea>
   <button class="btn pri full" id="pfOk" style="margin-top:14px">Enregistrer</button>`;
  $('#dlgBody').querySelectorAll('#pfS .chip,#pfJ .chip').forEach(c => c.onclick = () => c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'));
  $('#dlg').showModal();
  $('#pfOk').onclick = async () => {
    const np = Object.assign({}, p, { prenom: $('#pfN').value.trim() || p.prenom, sports: [...document.querySelectorAll('#pfS .chip[aria-pressed=true]')].map(c => c.dataset.o), jours: [...document.querySelectorAll('#pfJ .chip[aria-pressed=true]')].map(c => c.dataset.o), blessures: $('#pf_bl').value.trim(), refs: {} });
    PFIELDS.forEach(([k]) => np[k] = $('#pf_' + k).value.trim());
    REFS.forEach(([k]) => { const v = $('#rf_' + k).value.trim(); if (v) np.refs[k] = v; });
    await save('profile', np); $('#dlg').close(); renderAll(); pushSummary();
  };
}
$('#editBtn').onclick = editProfile;
function drawProfile() {
  const p = S.profile || {};
  $('#bibName').textContent = p.prenom || 'Athlète'; $('#bibSport').textContent = [(p.sports || []).slice(0, 2).join(' · '), p.niveau].filter(Boolean).join(' · ') || 'Coaching personnel · tous sports';
  let goal = p.objectif || ''; if (p.date) { const dd = Math.ceil((new Date(p.date + 'T09:00') - new Date()) / 864e5); if (dd >= 0) goal += ' · J-' + dd; }
  $('#bibGoal').textContent = goal;
  const rows = [['Sports', (p.sports || []).join(', ')], ['Niveau', p.niveau], ['Objectif', [p.objectif, p.date, p.chrono].filter(Boolean).join(' · ')], ['Heures / semaine', p.heures], ['Jours', (p.jours || []).join(', ') || 'tous'], ['Repères', REFS.filter(([k]) => p.refs?.[k]).map(([k, l, u]) => l + ' ' + p.refs[k] + ' ' + u).join(' · ')], ['Blessures', p.blessures]];
  $('#prof').innerHTML = rows.map(([l, v]) => `<div class="card" style="margin:0"><div class="small mut">${esc(l)}</div><div>${esc(v || '—')}</div></div>`).join('');
  $('#meEmail').textContent = user?.email || '';
}
$('#logoutBtn').onclick = $('#blockedOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('#shareBtn').onclick = async () => { try { await navigator.clipboard.writeText(APP_URL); $('#shareMsg').textContent = 'Lien copié.'; } catch (e) { $('#shareMsg').textContent = APP_URL; } };

/* ---------- sources (agenda, Strava, sommeil) ---------- */
function srcHTML() {
  const ics = S.sources?.ics || [], cal = S.cal;
  const row = (c, ic, t, d, btn, more = '') => `<div class="src"><span class="ic" style="background:${c}">${ic}</span><div><b>${t}</b><div class="small mut">${d}</div></div>${btn}${more ? `<div class="more">${more}</div>` : ''}</div>`;
  const icsList = ics.map(u => `<div class="row sp small" style="margin-top:6px"><span>${esc(u.name)} · <span class="mut">${esc(u.url.replace(/^https?:\/\//, '').slice(0, 28))}…</span></span><button class="btn sm danger" data-rmics="${esc(u.id)}">Retirer</button></div>`).join('');
  const agenda = row('#4f8ea3', '31', 'Agenda (cours, examens)', ics.length ? `${ics.length} agenda(s) · ${(cal?.evs || []).length} événements${cal?.at ? ' · lu il y a ' + ago(cal.at) : ''}` : 'Colle le lien iCal de ton agenda : Google Agenda, my.devinci (ESILV), ADE, Outlook…', `<button class="btn sm" data-a="addics">${ics.length ? 'Ajouter' : 'Connecter'}</button>`, icsList + (cal?.errs?.length ? `<p class="err">${esc(cal.errs.join(' · '))}</p>` : ''));
  const st = row('#fc5200', 'S', 'Strava', strava?.connected ? `Connecté${strava.athlete?.firstname ? ' (' + esc(strava.athlete.firstname) + ')' : ''} · ${data?.n || 0} activités sur 6 semaines` : 'Toutes tes activités, quelle que soit ta montre (Garmin, COROS, Samsung, Apple…).', strava?.connected ? '<button class="btn sm" data-a="stravaoff">Déconnecter</button>' : '<button class="btn sm strava" data-a="strava">Connecter</button>');
  const h = health[0];
  const sleepBtn = isNative() ? '<button class="btn sm" data-a="health">Connecter</button>' : '<button class="btn sm" data-a="healthhow">Configurer</button>';
  const sl = row('#22453b', 'Zz', 'Sommeil · VFC · FC repos', h ? `Reçu le ${new Date(h.date).toLocaleDateString('fr-FR')} (${h.source === 'health_connect' ? 'Health Connect' : h.source === 'iphone' ? 'Apple Santé' : esc(h.source)})` : 'Garmin, COROS et Samsung : via Health Connect (appli Android). iPhone : via un Raccourci Apple Santé.', sleepBtn);
  return agenda + st + sl;
}
function bindSrc(root) {
  const q = s => root.querySelector(s);
  q('[data-a=addics]') && (q('[data-a=addics]').onclick = addIcsDialog);
  root.querySelectorAll('[data-rmics]').forEach(b => b.onclick = async () => { await save('sources', Object.assign({}, S.sources, { ics: (S.sources.ics || []).filter(x => x.id !== b.dataset.rmics) })); await syncCalendars(true); renderAll(); });
  q('[data-a=strava]') && (q('[data-a=strava]').onclick = connectStrava);
  q('[data-a=stravaoff]') && (q('[data-a=stravaoff]').onclick = async () => { await fn('strava-connect', { body: { action: 'disconnect' } }).catch(() => { }); await stravaStatus(); data = null; renderAll(); });
  q('[data-a=health]') && (q('[data-a=health]').onclick = async () => { await nativeHealthSync(false); renderAll(); });
  q('[data-a=healthhow]') && (q('[data-a=healthhow]').onclick = healthHowDialog);
}
function addIcsDialog() {
  $('#dlgBody').innerHTML = `<h3>Ajouter un agenda</h3>
   <label for="icN">Nom</label><input id="icN" placeholder="Ex : Cours ESILV" value="${(S.sources?.ics || []).length ? '' : 'Mon agenda'}">
   <label for="icU">Lien iCal (.ics)</label><input id="icU" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" inputmode="url">
   <div class="tip"><b>Google Agenda</b> (sur ordinateur) :<ol><li>calendar.google.com → ⚙️ Paramètres</li><li>À gauche, clique sur ton agenda</li><li>« Intégrer l'agenda » → copie l'<b>adresse secrète au format iCal</b></li></ol>
   <b>ESILV / De Vinci</b> : sur my.devinci.fr, copie le lien « Télécharger au format iCal » et colle-le ici directement.<br><span class="mut">Le lien reste privé : il n'est lu que par ton compte.</span></div>
   <p class="err" id="icErr"></p><button class="btn pri full" id="icOk" style="margin-top:12px">Ajouter et lire</button>`;
  $('#dlg').showModal();
  $('#icOk').onclick = async () => {
    const url = $('#icU').value.trim(); if (!/^(https|webcal):\/\//i.test(url)) { $('#icErr').textContent = 'Colle un lien qui commence par https:// ou webcal://'; return; }
    $('#icOk').disabled = true; $('#icErr').textContent = 'Lecture…';
    try { const r = await fn('calendar-fetch', { body: { url } }); const n = parseICS(r.ics).length;
      await save('sources', Object.assign({}, S.sources, { ics: [...(S.sources?.ics || []), { id: Date.now().toString(36), name: $('#icN').value.trim() || 'Agenda', url }] }));
      await syncCalendars(true); $('#dlg').close(); toast(n + ' événements trouvés.'); renderAll();
    } catch (e) { $('#icErr').textContent = 'Lecture impossible : ' + e.message; $('#icOk').disabled = false; }
  };
}
async function healthHowDialog() {
  const tok = me?.ingest_token || '';
  const ua = navigator.userAgent, ios = /iPhone|iPad/.test(ua), android = /Android/.test(ua);
  $('#dlgBody').innerHTML = `<h3>Sommeil et récupération</h3>
   <div class="seg2"><button class="btn sm ${!ios ? 'pri' : ''}" data-os="a">Android</button><button class="btn sm ${ios ? 'pri' : ''}" data-os="i">iPhone</button></div>
   <div id="osA" ${ios ? 'hidden' : ''}><p class="small">Samsung Health, Garmin Connect et COROS savent écrire dans <b>Health Connect</b>, le coffre santé d'Android. L'appli Mon Coach pour Android le lit à chaque ouverture.</p>
    <ol class="small"><li>Dans Garmin Connect / COROS / Samsung Health : Paramètres → Health Connect → autorise le <b>sommeil</b>, la <b>VFC</b> et la <b>FC au repos</b>.</li><li>Installe l'appli Mon Coach Android ${APK_URL ? `: <a href="${esc(APK_URL)}">télécharger l'APK</a>` : '(lien fourni par ton coach)'} et connecte-toi avec le même compte.</li><li>Profil → Sources → Sommeil → Connecter, puis autorise la lecture.</li></ol></div>
   <div id="osI" ${ios ? '' : 'hidden'}><p class="small">Garmin, COROS et Samsung peuvent écrire dans <b>Apple Santé</b>. Un Raccourci envoie chaque matin ta nuit à ton compte.</p>
    <ol class="small"><li>Appli <b>Raccourcis</b> → Automatisation → Nouvelle → Heure de la journée, 9:00, tous les jours, « Exécuter immédiatement ».</li>
    <li>Action <b>Rechercher des échantillons de santé</b> : Type = Analyse du sommeil, Date de début = dans les derniers 1 jour. Puis <b>Calculer les statistiques</b> → Somme, sur la Durée (en heures).</li>
    <li>Action <b>Rechercher des échantillons de santé</b> : Variabilité du rythme cardiaque, derniers 1 jour, trier par date, limite 1. Idem pour Fréquence cardiaque au repos.</li>
    <li>Action <b>Obtenir le contenu de l'URL</b> : <code>${esc(FN_BASE)}</code>, Méthode POST, En-tête <code>x-ingest-token</code> = <code>${esc(tok)}</code>, Corps JSON : <code>sleep_hours</code>, <code>hrv_ms</code>, <code>resting_hr</code> (les résultats ci-dessus).</li></ol>
    <p class="small mut">Ce jeton est personnel : ne le partage pas. <button class="btn sm" id="rotTok">Changer de jeton</button></p></div>`;
  $('#dlg').showModal();
  $('#dlgBody').querySelectorAll('[data-os]').forEach(b => b.onclick = () => { $('#osA').hidden = b.dataset.os !== 'a'; $('#osI').hidden = b.dataset.os !== 'i'; $('#dlgBody').querySelectorAll('[data-os]').forEach(x => x.classList.toggle('pri', x === b)); });
  $('#rotTok').onclick = async () => { const { data: t } = await sb.rpc('rotate_ingest_token'); if (t) { me.ingest_token = t; healthHowDialog(); } };
}
function drawSources() { $('#srcBox').innerHTML = srcHTML(); bindSrc($('#srcBox')); }

/* ---------- inscription : compte → sources → semaine type ---------- */
let onbStep = 0;
function onbHead(t, sub) { return `<div class="row sp" style="margin-bottom:14px"><div class="brand"><i></i>Mon Coach</div><span class="mono">Étape ${onbStep} sur 3</span></div><div class="steps">${[1, 2, 3].map(i => `<i class="${i <= onbStep ? 'on' : ''}"></i>`).join('')}</div><h2>${t}</h2><p class="mut">${sub}</p>`; }
function openOnb(step) { onbStep = step; $('#onb').classList.add('on'); drawOnb(); }
function drawAuth(mode = 'signup') {
  const box = $('#onbIn');
  box.innerHTML = `<div class="onbhero">${$('#topoTpl').innerHTML}<div style="position:relative"><div class="brand"><i></i>Mon Coach</div><h2>${mode === 'signup' ? 'Ton plan, calé sur ta vraie semaine.' : 'Content de te revoir.'}</h2><p>Tes cours, tes créneaux, Strava et ton sommeil, croisés pour un plan d'entraînement réaliste.</p></div></div>
   <div class="seg" style="grid-template-columns:1fr 1fr"><button data-m="signup" aria-pressed="${mode === 'signup'}">Créer un compte</button><button data-m="login" aria-pressed="${mode === 'login'}">Se connecter</button></div>
   ${mode === 'signup' ? `<label for="aN">Prénom</label><input id="aN" autocomplete="given-name">` : ''}
   <label for="aE">E-mail</label><input id="aE" type="email" autocomplete="email" inputmode="email">
   <label for="aP">Mot de passe</label><input id="aP" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="6">
   ${mode === 'signup' ? `<label>Tes sports <span class="mut" style="font-weight:400">(facultatif)</span></label><div class="chips" id="aS">${SPORTS.map(x => `<button class="chip" data-o="${esc(x)}" aria-pressed="false">${esc(x)}</button>`).join('')}</div>` : ''}
   <p class="err" id="aErr"></p><button class="btn pri full" id="aOk" style="margin-top:14px">${mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button>
   ${mode === 'login' ? '<p class="small" style="text-align:center"><a href="#" id="aForgot">Mot de passe oublié ?</a></p>' : ''}
   ${configured ? '' : '<p class="err">Appli pas encore reliée à Supabase (variables manquantes).</p>'}`;
  box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => drawAuth(b.dataset.m));
  box.querySelectorAll('#aS .chip').forEach(c => c.onclick = () => c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'));
  const f = $('#aForgot'); if (f) f.onclick = async e => { e.preventDefault(); const em = $('#aE').value.trim(); if (!em) { $('#aErr').textContent = 'Indique ton e-mail.'; return; } await sb.auth.resetPasswordForEmail(em, { redirectTo: APP_URL }); $('#aErr').textContent = 'Si ce compte existe, un e-mail de réinitialisation est parti.'; };
  $('#aOk').onclick = async () => {
    const em = $('#aE').value.trim(), pw = $('#aP').value; $('#aErr').textContent = '';
    if (!em || pw.length < 6) { $('#aErr').textContent = 'E-mail et mot de passe (6 caractères min.) requis.'; return; }
    $('#aOk').disabled = true;
    if (mode === 'signup') {
      const prenom = $('#aN').value.trim(); if (!prenom) { $('#aErr').textContent = 'Indique ton prénom.'; $('#aOk').disabled = false; return; }
      const sports = [...box.querySelectorAll('#aS .chip[aria-pressed=true]')].map(c => c.dataset.o);
      const { data: d, error } = await sb.auth.signUp({ email: em, password: pw, options: { data: { prenom }, emailRedirectTo: APP_URL } });
      if (error) { $('#aErr').textContent = error.message; $('#aOk').disabled = false; return; }
      localStorage.setItem('mc_pending_profile', JSON.stringify({ prenom, sports }));
      if (!d.session) { $('#aErr').innerHTML = '<span class="okmsg">Compte créé. Clique sur le lien reçu par e-mail, puis reviens te connecter.</span>'; $('#aOk').disabled = false; drawAuth('login'); $('#aErr').innerHTML = '<span class="okmsg">Compte créé. Valide le lien reçu par e-mail, puis connecte-toi.</span>'; return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) { $('#aErr').textContent = error.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : error.message; $('#aOk').disabled = false; return; }
    }
    await boot();
  };
}
function drawOnb() {
  const box = $('#onbIn');
  if (onbStep === 1) { drawAuth('signup'); return; }
  if (onbStep === 2) {
    box.innerHTML = onbHead('Connecte tes sources', 'Tout se synchronise ensuite tout seul à chaque ouverture. Tu peux passer et le faire plus tard dans Profil.') + `<div class="card" style="padding:4px 16px" id="onbSrc">${srcHTML()}</div><div class="row sp" style="margin-top:14px"><span></span><button class="btn pri" id="oNext">Continuer</button></div>`;
    bindSrc($('#onbSrc'));
    $('#oNext').onclick = async () => { await save('profile', Object.assign({}, S.profile, { onb: Math.max(S.profile?.onb || 0, 2) })); onbStep = 3; drawOnb(); };
    return;
  }
  box.innerHTML = onbHead('Ta semaine type', 'Ajoute tes créneaux récurrents comme dans Google Agenda : touche une case vide. Ex : natation à Viroflay mardi 18h30-20h.') +
    `<div id="onbCal"></div><p class="small mut" style="margin-top:8px">Pour chaque créneau, indique le temps de trajet depuis l'école et depuis chez toi : c'est ce qui permet de savoir si c'est faisable après tes cours.</p>
    <div class="row sp" style="margin-top:14px"><button class="btn" id="oBack">Retour</button><button class="btn pri" id="oNext">Terminer</button></div>`;
  drawCal($('#onbCal'), 'type');
  $('#oBack').onclick = () => { onbStep = 2; drawOnb(); };
  $('#oNext').onclick = async () => { await save('profile', Object.assign({}, S.profile, { onb: 3 })); $('#onb').classList.remove('on'); calView = '0'; location.hash = '#agenda'; renderAll(); pushSummary(); };
}
// rafraîchir l'écran sources de l'inscription après un retour Strava / Health
function refreshOnbSrc() { if ($('#onb').classList.contains('on') && onbStep === 2) drawOnb(); }

/* ---------- résumé pour l'admin + accès ---------- */
let lastPush = '';
async function pushSummary() {
  if (!user) return;
  const p = S.profile || {}, L = loadStats(), pl = S.plan;
  const summary = { niveau: p.niveau || '', objectif: p.objectif || '', date: p.date || '', heures: p.heures || '', prevu: pl ? planMin(pl) : 0, fait: pl ? doneMin(pl) : 0, planSemaine: pl?.semaine || '', forme: readiness(), h7: L ? +L.h7.toFixed(1) : null, tsb: L ? L.tsb : null, strava: !!strava?.connected, agenda: !!(S.sources?.ics || []).length, sommeil: !!health.length, creneaux: slots().length };
  const sig = JSON.stringify([p.prenom, p.sports, summary, today()]); if (sig === lastPush) return; lastPush = sig;
  await sb.from('profiles').update({ prenom: p.prenom || '', sports: p.sports || [], summary, last_seen: new Date().toISOString() }).eq('id', user.id);
}
function drawAccess() {
  const sus = me?.status === 'suspendu' && !isAdmin;
  $('#blocked').classList.toggle('on', sus); if (sus) $('#blockedTxt').textContent = me.motif || 'Contacte la personne qui t\'a partagé l\'appli.';
  $('#coachNote').hidden = !me?.note; $('#coachNoteTxt').textContent = me?.note || '';
}
let MEM = [];
async function loadAdmin() {
  if (!isAdmin) return;
  const { data: rows, error } = await sb.from('profiles').select('id,email,prenom,sports,role,status,motif,note,summary,created_at,last_seen').order('last_seen', { ascending: false });
  if (error) { $('#admList').innerHTML = '<p class="err">Lecture des inscrits impossible.</p>'; return; }
  MEM = rows || []; drawAdmin();
}
function drawAdmin() {
  const q = $('#admQ').value.trim().toLowerCase(), f = $('#admF').value, now = Date.now(), seen = m => new Date(m.last_seen).getTime();
  const act = MEM.filter(m => now - seen(m) < 7 * 864e5).length, sus = MEM.filter(m => m.status === 'suspendu').length;
  $('#admKpi').innerHTML = [['Inscrits', MEM.length], ['Actifs 7 j', act], ['Suspendus', sus], ['Avec Strava', MEM.filter(m => m.summary?.strava).length]].map(([l, v]) => `<div><span class="mono">${esc(l)}</span><span class="v">${esc(v)}</span></div>`).join('');
  const shown = MEM.filter(m => (!q || JSON.stringify([m.prenom, m.email, m.sports, m.summary?.niveau, m.summary?.objectif]).toLowerCase().includes(q)) && (!f || (f === 'suspendu' ? m.status === 'suspendu' : f === 'actif' ? m.status !== 'suspendu' && now - seen(m) < 14 * 864e5 : now - seen(m) >= 14 * 864e5)));
  $('#admList').innerHTML = shown.length ? shown.map(m => {
    const s = m.status === 'suspendu', sm = m.summary || {}, pct = sm.prevu ? Math.round(sm.fait / sm.prevu * 100) : null, self = m.id === user.id;
    return `<div class="mem"><div><b>${esc(m.prenom || 'Sans nom')}</b> ${m.role === 'admin' ? '<span class="badge n">Admin</span> ' : ''}${s ? '<span class="badge">Suspendu</span>' : now - seen(m) < 7 * 864e5 ? '<span class="badge ok">Actif</span>' : '<span class="badge n">Inactif</span>'}<div class="small mut">${esc(m.email)} · ${esc((m.sports || []).join(', '))}${sm.niveau ? ' · ' + esc(sm.niveau) : ''}</div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn sm" data-msg="${esc(m.id)}">Message</button>${self ? '' : `<button class="btn sm${s ? '' : ' danger'}" data-sus="${esc(m.id)}">${s ? 'Réactiver' : 'Suspendre'}</button>`}</div>
    <div class="small">${esc(sm.objectif || '—')}${sm.date ? ' · ' + esc(sm.date) : ''} · ${esc(sm.heures || '?')} h/sem · semaine : ${pct == null ? 'pas de plan' : esc(pct) + ' % fait'}${sm.tsb != null ? ' · fraîcheur ' + esc(sm.tsb) : ''}${sm.forme != null ? ' · forme ' + esc(sm.forme) + '/100' : ''}</div>
    <div class="small mut">Vu il y a ${esc(ago(seen(m)) || '?')} · inscrit le ${new Date(m.created_at).toLocaleDateString('fr-FR')} · ${sm.strava ? 'Strava ✓' : 'sans Strava'} · ${sm.agenda ? 'agenda ✓' : 'sans agenda'} · ${sm.sommeil ? 'sommeil ✓' : 'sans sommeil'}${m.note ? ' · message : « ' + esc(m.note.slice(0, 60)) + ' »' : ''}</div></div>`;
  }).join('') : '<p class="small mut">Personne pour l\'instant. Partage le lien depuis l\'onglet Profil.</p>';
  $('#admList').querySelectorAll('[data-sus]').forEach(b => b.onclick = async () => {
    const m = MEM.find(x => x.id === b.dataset.sus), to = m.status === 'suspendu' ? 'actif' : 'suspendu';
    b.disabled = true; const { error } = await sb.from('profiles').update({ status: to }).eq('id', m.id); if (error) b.textContent = 'Refusé'; else loadAdmin();
  });
  $('#admList').querySelectorAll('[data-msg]').forEach(b => b.onclick = () => {
    const m = MEM.find(x => x.id === b.dataset.msg);
    $('#dlgBody').innerHTML = `<h3>Message pour ${esc(m.prenom || 'cet inscrit')}</h3><p class="small mut">Il s'affiche en haut de son écran Aujourd'hui. Laisse vide pour l'effacer.</p><textarea id="admNote" rows="4">${esc(m.note || '')}</textarea><label for="admMotif">Motif affiché si suspendu</label><input id="admMotif" value="${esc(m.motif || '')}"><button class="btn pri" id="admSave" style="margin-top:10px">Enregistrer</button>`;
    $('#dlg').showModal(); $('#admSave').onclick = async () => { const { error } = await sb.from('profiles').update({ note: $('#admNote').value.trim(), motif: $('#admMotif').value.trim() }).eq('id', m.id); if (error) $('#admSave').textContent = 'Refusé'; else { $('#dlg').close(); loadAdmin(); } };
  });
}
$('#admQ').oninput = drawAdmin; $('#admF').onchange = drawAdmin;

/* ---------- rendu ---------- */
function drawToday() {
  const p = S.profile || {}, now = new Date();
  $('#helloT').textContent = p.prenom ? 'Salut ' + p.prenom : 'Aujourd\'hui'; $('#helloD').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const L = allEvents(), inf = dayInfo(now, L), nx = L.find(e => e.x && e.s > Date.now());
  $('#helloS').textContent = (inf.examens.length ? 'Jour d\'examen, on reste léger. ' : inf.veille_examen.length ? 'Veille d\'examen : rien de dur. ' : inf.charge === 'chargée' ? 'Grosse journée de cours. ' : '') + (nx ? 'Prochain examen ou compétition : ' + nx.t + ' le ' + new Date(nx.s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + '.' : '');
  $('#todayEv').innerHTML = inf.ev.length ? inf.ev.map(evRow).join('') : '<p class="small mut">Rien dans ton agenda aujourd\'hui.</p>';
  const tsl = weekStatus(0).filter(x => x.date === today());
  if (tsl.length) $('#todayEv').innerHTML += tsl.map(x => { const [l, c] = ST_LBL[x.final]; return `<div class="ev"><time>${esc(x.slot.s)}–${esc(x.slot.e)}</time><span>${esc(x.slot.t)} <span class="badge ${c}">${l}</span><br><span class="small mut">${esc(x.why)}</span></span></div>`; }).join('');
}
let syncing = false;
function drawPill() {
  const t = Math.max(S.cal?.at || 0, strava?.last_sync ? new Date(strava.last_sync).getTime() : 0);
  $('#syncPill').classList.toggle('off', !navigator.onLine);
  $('#syncTxt').textContent = syncing ? 'Synchro…' : !navigator.onLine ? 'Hors ligne' : t ? 'Synchro ' + ago(t) : 'À synchroniser';
}
function toast(m) { $('#ciMsg').textContent = ''; const el = document.createElement('div'); el.textContent = m; el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom,0px));background:#1d2422;color:#f3eee4;padding:10px 16px;border-radius:10px;z-index:50;max-width:90vw;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(el); setTimeout(() => el.remove(), 4500); }
function renderAll() { drawAgendaCal(); drawAgendaList(); drawProfile(); drawSources(); drawCheckin(); drawRing(); drawHealth(); drawBars(); drawPlan(); drawToday(); drawLoad(); drawLast(); drawPill(); drawAccess(); refreshOnbSrc(); }

async function autoSync(force) {
  if (syncing) return; syncing = true; drawPill();
  const STALE = 2 * 36e5, jobs = [];
  if (force || !S.cal || Date.now() - S.cal.at > STALE) jobs.push(syncCalendars(true));
  if (strava?.connected && (force || !strava.last_sync || Date.now() - new Date(strava.last_sync).getTime() > STALE)) jobs.push(syncStrava(true));
  if (isNative()) jobs.push(nativeHealthSync(true));
  await Promise.allSettled(jobs); syncing = false; renderAll(); pushSummary();
}
$('#syncPill').onclick = () => autoSync(true);

/* ---------- démarrage ---------- */
async function boot() {
  if (!configured) { openOnb(1); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { openOnb(1); return; }
  user = session.user;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', user.id).single();
  me = prof || {}; isAdmin = me.role === 'admin'; $('#admTab').hidden = !isAdmin;
  await loadAll();
  const pend = JSON.parse(localStorage.getItem('mc_pending_profile') || 'null');
  if (!S.profile) { await save('profile', Object.assign({ prenom: me.prenom || pend?.prenom || '', sports: pend?.sports || [], onb: 1, depuis: Date.now() })); }
  localStorage.removeItem('mc_pending_profile');
  await Promise.all([stravaStatus(), loadActivities(), loadHealth()]);
  route(); renderAll();
  await handleStravaReturn();
  if ((S.profile.onb || 0) < 3) openOnb(Math.min(3, Math.max(2, (S.profile.onb || 1) + 1)));
  else $('#onb').classList.remove('on');
  pushSummary(); autoSync(false);
}
// Liens reçus par e-mail (confirmation d'inscription, mot de passe oublié) : jetons dans l'ancre de l'URL
async function handleEmailLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('access_token') || !h.get('refresh_token')) return;
  history.replaceState(null, '', location.pathname);
  await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
  if (h.get('type') === 'recovery') {
    $('#dlgBody').innerHTML = `<h3>Nouveau mot de passe</h3><input id="npw" type="password" minlength="6" autocomplete="new-password"><p class="err" id="npwErr"></p><button class="btn pri full" id="npwOk" style="margin-top:10px">Enregistrer</button>`;
    $('#dlg').showModal();
    $('#npwOk').onclick = async () => { const { error } = await sb.auth.updateUser({ password: $('#npw').value }); if (error) $('#npwErr').textContent = error.message; else $('#dlg').close(); };
  }
}
route();
(async () => { if (sb) await handleEmailLink(); boot(); })();
if ('serviceWorker' in navigator && !isNative()) navigator.serviceWorker.register('sw.js').catch(() => { });
