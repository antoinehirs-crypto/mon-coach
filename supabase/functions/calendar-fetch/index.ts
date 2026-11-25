// POST {url} -> renvoie le contenu iCal (évite le blocage CORS du navigateur)
import { cors, json, requireUser } from '../_shared/util.ts';

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1|\[?f[cd])/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  let u: URL;
  try { u = new URL(String(body.url || '').replace(/^webcal:/i, 'https:')); } catch { return json({ error: 'url_invalide' }, 400); }
  if (u.protocol !== 'https:' || PRIVATE.test(u.hostname)) return json({ error: 'url_refusee' }, 400);
  const r = await fetch(u, { headers: { Accept: 'text/calendar, */*' }, redirect: 'follow' }).catch(() => null);
  if (!r || !r.ok) return json({ error: 'lecture_impossible', detail: r?.status ?? 'reseau' }, 400);
  const text = await r.text();
  if (text.length > 5_000_000 || !text.includes('BEGIN:VCALENDAR')) return json({ error: 'pas_un_agenda' }, 400);
  return json({ ics: text });
});
