// Lecture d'un agenda iCal (Google Agenda « adresse secrète », my.devinci, ADE, Outlook…)
// Gère les événements récurrents simples (RRULE DAILY/WEEKLY avec BYDAY, INTERVAL, COUNT, UNTIL, EXDATE)
// et les occurrences modifiées (RECURRENCE-ID).

export const EXAM = /examen|partiel|\bexam\b|\bds\b|contr[ôo]le|rattrapage|soutenance|concours|\boral\b|compétition|course|match/i;
// ESILV : lieu « ESILV Paris - Parc » = présentiel, « ESILV (en ligne) » = visio
export const modeOf = (t, l) => /en ligne|online|zoom|visio|distanciel|teams|webex|\[[A-Za-z]+o\]/i.test((t || '') + ' ' + (l || '')) ? 'visio' : 'site';

const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseDate(prop) {
  // prop = {params, value}
  const m = (prop?.value || '').match(/(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?/);
  if (!m) return null;
  const a = [+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  const allDay = !m[4];
  const t = m[7] ? Date.UTC(...a) : new Date(...a).getTime(); // TZID : heure locale (Paris)
  return { t, allDay };
}

function unescape(s) { return (s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }

export function parseICS(text, src = 'ics', opts = {}) {
  const lo = opts.from ?? Date.now() - 7 * 864e5, hi = opts.to ?? Date.now() + 70 * 864e5;
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const vevents = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) vevents.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const [name, ...params] = head.split(';');
    const p = { params: Object.fromEntries(params.map(x => x.split('='))), value };
    if (name === 'EXDATE') (cur.EXDATE = cur.EXDATE || []).push(...value.split(',').map(v => parseDate({ value: v })?.t));
    else cur[name] = p;
  }
  const overrides = new Set();
  vevents.forEach(v => { if (v['RECURRENCE-ID']) overrides.add(v.UID?.value + '|' + parseDate(v['RECURRENCE-ID'])?.t); });

  const out = [];
  const push = (v, s, e, allDay) => {
    if (e < lo || s > hi) return;
    const t = unescape(v.SUMMARY?.value) || 'Occupé', loc = unescape(v.LOCATION?.value);
    out.push({ s, e, t, x: EXAM.test(t), src, allDay, m: modeOf(t, loc), loc });
  };
  for (const v of vevents) {
    if ((v.STATUS?.value || '').toUpperCase() === 'CANCELLED') continue;
    const ds = parseDate(v.DTSTART); if (!ds) continue;
    let de = parseDate(v.DTEND);
    let dur = de ? de.t - ds.t : (ds.allDay ? 864e5 : 0);
    if (!de && v.DURATION) { const m = v.DURATION.value.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/); if (m) dur = ((+m[1] || 0) * 24 * 60 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 6e4; }
    const rr = v.RRULE?.value;
    if (!rr || v['RECURRENCE-ID']) { push(v, ds.t, ds.t + dur, ds.allDay); continue; }
    const R = Object.fromEntries(rr.split(';').map(x => x.split('=')));
    const freq = R.FREQ, interval = +(R.INTERVAL || 1), count = R.COUNT ? +R.COUNT : Infinity;
    const until = R.UNTIL ? parseDate({ value: R.UNTIL }).t : Infinity;
    if (freq !== 'DAILY' && freq !== 'WEEKLY') { push(v, ds.t, ds.t + dur, ds.allDay); continue; }
    const start = new Date(ds.t);
    const byday = R.BYDAY ? R.BYDAY.split(',').map(d => DOW[d.slice(-2)]) : [start.getDay()];
    const ex = new Set(v.EXDATE || []);
    let n = 0;
    // on avance jour par jour (heure locale conservée), borne de sécurité 3 ans
    for (let k = 0; k < 1100 && n < count; k++) {
      const d = new Date(start); d.setDate(start.getDate() + k);
      const t = d.getTime();
      if (t > until || t > hi) break;
      const days = Math.floor((new Date(d).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / 864e5 + .5);
      let ok;
      if (freq === 'DAILY') ok = days % interval === 0;
      else {
        const mon = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - ((y.getDay() + 6) % 7)); return y.getTime(); };
        const weeks = Math.round((mon(d) - mon(start)) / (7 * 864e5));
        ok = weeks % interval === 0 && byday.includes(d.getDay());
      }
      if (!ok) continue;
      n++;
      if (ex.has(t) || overrides.has(v.UID?.value + '|' + t)) continue;
      push(v, t, t + dur, ds.allDay);
    }
  }
  return out.sort((a, b) => a.s - b.s).slice(0, 1500);
}
