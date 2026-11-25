// Sommeil, VFC et FC repos.
// - Appli Android (Capacitor) : lit Health Connect, où Samsung Health, Garmin Connect et COROS écrivent.
// - Navigateur : rien à lire directement ; l'iPhone envoie via un Raccourci (fonction health-ingest).
import { Capacitor } from '@capacitor/core';
import { Health } from '@capgo/capacitor-health';
import { sb } from './supa.js';

export const isNative = () => Capacitor.isNativePlatform();
const TYPES = ['sleep', 'heartRateVariability', 'restingHeartRate'];
const EXTRA = ['weight', 'vo2Max'];
const dkey = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export async function healthAvailable() {
  if (!isNative()) return { available: false, reason: 'web' };
  try { return await Health.isAvailable(); } catch (e) { return { available: false, reason: e.message }; }
}

export async function connectHealth() {
  const st = await Health.requestAuthorization({ read: [...TYPES, ...EXTRA] });
  return st;
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

/** Lit les 14 dernières nuits et les enregistre dans health_daily. */
export async function syncHealth(userId, days = 14) {
  const end = new Date(), start = new Date(Date.now() - days * 864e5);
  const q = t => Health.readSamples({ dataType: t, startDate: start.toISOString(), endDate: end.toISOString(), limit: 2000 }).then(r => r.samples || []).catch(() => []);
  const [sleep, hrv, rhr] = await Promise.all(TYPES.map(q));
  const byDay = {};
  const day = k => (byDay[k] = byDay[k] || { user_id: userId, date: k, source: 'health_connect', sleep_min: 0, deep_min: 0, rem_min: 0, _hrv: [], _rhr: [] });
  // une nuit est rattachée au jour du réveil
  sleep.forEach(s => {
    const k = dkey(s.endDate), d = day(k);
    if (s.stages && s.stages.length) {
      s.stages.forEach(st => { if (st.stage !== 'awake' && st.stage !== 'inBed') d.sleep_min += st.durationMinutes; if (st.stage === 'deep') d.deep_min += st.durationMinutes; if (st.stage === 'rem') d.rem_min += st.durationMinutes; });
    } else if (!s.sleepState || !['awake', 'inBed'].includes(s.sleepState)) {
      d.sleep_min += (new Date(s.endDate) - new Date(s.startDate)) / 6e4;
    }
  });
  hrv.forEach(s => day(dkey(s.startDate))._hrv.push(s.value));
  rhr.forEach(s => day(dkey(s.startDate))._rhr.push(s.value));
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
  const rows = Object.values(byDay).map(d => {
    const r = { user_id: d.user_id, date: d.date, source: d.source, updated_at: new Date().toISOString() };
    if (d.sleep_min) { r.sleep_min = Math.round(d.sleep_min); r.deep_min = Math.round(d.deep_min) || null; r.rem_min = Math.round(d.rem_min) || null; }
    if (d._hrv.length) r.hrv_ms = avg(d._hrv);
    if (d._rhr.length) r.resting_hr = Math.min(...d._rhr);
    return r;
  }).filter(r => r.sleep_min || r.hrv_ms || r.resting_hr);
  if (rows.length) { const { error } = await sb.from('health_daily').upsert(rows); if (error) throw error; }
  return rows.length;
}
