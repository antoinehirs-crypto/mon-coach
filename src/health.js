// Sommeil, VFC et FC repos.
// - Appli Android (Capacitor) : lit Health Connect, où Samsung Health, Garmin Connect et COROS écrivent.
// - Navigateur : rien à lire directement ; l'iPhone envoie via un Raccourci (fonction health-ingest).
import { Capacitor } from '@capacitor/core';
import { Health } from '@capgo/capacitor-health';
import { sb } from './supa.js';

export const isNative = () => Capacitor.isNativePlatform();
const TYPES = ['sleep', 'heartRateVariability', 'restingHeartRate', 'heartRate'];
const EXTRA = ['weight', 'vo2Max'];
const dkey = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export async function healthAvailable() {
  if (!isNative()) return { available: false, reason: 'web' };
  try { return await Health.isAvailable(); } catch (e) { return { available: false, reason: e.message }; }
}

export async function connectHealth() {
  return await Health.requestAuthorization({ read: [...TYPES, ...EXTRA] });
}
/** Types refusés (pour expliquer quoi autoriser). */
export async function healthDenied() {
  try { const st = await Health.checkAuthorization({ read: [...TYPES, ...EXTRA] }); return st.readDenied || []; } catch (e) { return null; }
}

/** Nom lisible de l'appli qui a écrit la donnée dans Health Connect. */
export function srcLabel(id) {
  const x = String(id || '').toLowerCase();
  if (/shealth|samsung/.test(x)) return 'Samsung Health';
  if (/coros/.test(x)) return 'COROS';
  if (/garmin/.test(x)) return 'Garmin Connect';
  if (/fitbit/.test(x)) return 'Fitbit';
  if (/google\.android\.apps\.fitness/.test(x)) return 'Google Fit';
  if (/polar/.test(x)) return 'Polar';
  if (/suunto/.test(x)) return 'Suunto';
  if (/withings/.test(x)) return 'Withings';
  if (/oura/.test(x)) return 'Oura';
  return id ? String(id).split('.').slice(-1)[0] : 'inconnu';
}

export const openHealthSettings = () => Health.openHealthConnectSettings().catch(() => {});

/** Dernière valeur de poids et de VO2max (6 mois). */
export async function readExtras() {
  const end = new Date(), start = new Date(Date.now() - 180 * 864e5);
  const last = async t => { try { const r = await Health.readSamples({ dataType: t, startDate: start.toISOString(), endDate: end.toISOString(), limit: 500 }); const s = (r.samples || []).filter(x => x.value).sort((a, b) => new Date(b.endDate || b.startDate) - new Date(a.endDate || a.startDate))[0]; return s ? { v: s.value, at: s.endDate || s.startDate } : null; } catch (e) { return null; } };
  const [w, v] = await Promise.all(EXTRA.map(last));
  const o = {}; if (w) { o.weight = w.v; o.weight_at = w.at; } if (v) { o.vo2max = v.v; o.vo2max_at = v.at; }
  return o;
}

/**
 * Lit les 14 dernières nuits et les enregistre dans health_daily.
 * Plusieurs montres (Samsung + COROS) écrivent chacune leur nuit : on garde, nuit par nuit, la source la plus complète
 * (celle de la montre portée) au lieu d'additionner. FC repos absente : calculée à partir de la FC pendant la nuit.
 * Retourne { n, src: { sleep, hrv, rhr }, counts } pour le diagnostic.
 */
export async function syncHealth(userId, days = 14) {
  const end = new Date(), start = new Date(Date.now() - days * 864e5);
  const q = (t, lim = 5000, st = start) => Health.readSamples({ dataType: t, startDate: st.toISOString(), endDate: end.toISOString(), limit: lim }).then(r => r.samples || []).catch(() => []);
  const [sleep, hrv, rhr, hr] = await Promise.all([q('sleep'), q('heartRateVariability'), q('restingHeartRate'), q('heartRate', 20000, new Date(Date.now() - 4 * 864e5))]);
  // --- sommeil : par jour de réveil, puis par source ---
  const nights = {}; // k -> src -> { asleep, deep, rem, s0, s1 }
  sleep.forEach(s => {
    const k = dkey(s.endDate), src = srcLabel(s.sourceId || s.sourceName);
    const n = ((nights[k] = nights[k] || {})[src] = nights[k][src] || { asleep: 0, deep: 0, rem: 0, s0: Infinity, s1: 0, stages: false });
    n.s0 = Math.min(n.s0, +new Date(s.startDate)); n.s1 = Math.max(n.s1, +new Date(s.endDate));
    if (s.stages && s.stages.length) {
      n.stages = true;
      s.stages.forEach(st => { if (st.stage !== 'awake' && st.stage !== 'inBed') n.asleep += st.durationMinutes; if (st.stage === 'deep') n.deep += st.durationMinutes; if (st.stage === 'rem') n.rem += st.durationMinutes; });
    } else if (!s.sleepState || !['awake', 'inBed'].includes(s.sleepState)) {
      n.asleep += (new Date(s.endDate) - new Date(s.startDate)) / 6e4;
      if (s.sleepState === 'deep') n.deep += (new Date(s.endDate) - new Date(s.startDate)) / 6e4;
      if (s.sleepState === 'rem') n.rem += (new Date(s.endDate) - new Date(s.startDate)) / 6e4;
    }
  });
  const byDay = {}, used = { sleep: {}, hrv: {}, rhr: {} };
  const day = k => (byDay[k] = byDay[k] || { user_id: userId, date: k, source: 'health_connect' });
  Object.entries(nights).forEach(([k, bySrc]) => {
    // la plus complète : phases de sommeil détaillées d'abord, puis la plus longue
    const [src, n] = Object.entries(bySrc).sort((a, b) => (b[1].stages - a[1].stages) || (b[1].asleep - a[1].asleep))[0];
    if (n.asleep < 60) return;
    const d = day(k); d.sleep_min = Math.round(n.asleep); d.deep_min = Math.round(n.deep) || null; d.rem_min = Math.round(n.rem) || null; d._win = [n.s0, n.s1];
    used.sleep[src] = (used.sleep[src] || 0) + 1;
  });
  // --- VFC et FC repos : moyenne / minimum par jour (une seule source par jour, la plus fournie) ---
  const perDay = (list, field, agg) => {
    const g = {};
    list.forEach(s => { const k = dkey(s.startDate), src = srcLabel(s.sourceId || s.sourceName); ((g[k] = g[k] || {})[src] = g[k][src] || []).push(s.value); });
    Object.entries(g).forEach(([k, bySrc]) => { const [src, v] = Object.entries(bySrc).sort((a, b) => b[1].length - a[1].length)[0]; day(k)[field] = agg(v); used[field === 'hrv_ms' ? 'hrv' : 'rhr'][src] = (used[field === 'hrv_ms' ? 'hrv' : 'rhr'][src] || 0) + 1; });
  };
  const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10;
  perDay(hrv.filter(s => s.value > 5 && s.value < 300), 'hrv_ms', avg);
  perDay(rhr.filter(s => s.value > 25 && s.value < 120), 'resting_hr', a => Math.min(...a));
  // FC repos calculée : 5e centile de la FC pendant la nuit (Samsung Health n'écrit pas toujours la FC repos)
  Object.values(byDay).forEach(d => {
    if (d.resting_hr || !d._win) return;
    const v = hr.filter(s => { const t = +new Date(s.startDate); return t >= d._win[0] && t <= d._win[1] && s.value > 25 && s.value < 150; }).map(s => s.value).sort((a, b) => a - b);
    if (v.length >= 15) { d.resting_hr = Math.round(v[Math.floor(v.length * 0.05)]); used.rhr['calculée (FC de nuit)'] = (used.rhr['calculée (FC de nuit)'] || 0) + 1; }
  });
  const rows = Object.values(byDay).map(d => { const r = Object.assign({}, d, { updated_at: new Date().toISOString() }); delete r._win; return r; }).filter(r => r.sleep_min || r.hrv_ms || r.resting_hr);
  if (rows.length) { const { error } = await sb.from('health_daily').upsert(rows); if (error) throw error; }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(x => x[0]).join(', ') || null;
  return { n: rows.length, src: { sleep: top(used.sleep), hrv: top(used.hrv), rhr: top(used.rhr) }, counts: { sleep: sleep.length, hrv: hrv.length, rhr: rhr.length, hr: hr.length } };
}
