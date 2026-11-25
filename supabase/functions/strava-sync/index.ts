// POST {days?: number} -> rafraîchit le jeton si besoin, importe les activités (42 jours par défaut)
import { cors, json, requireUser } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { user, db } = auth;
  const body = await req.json().catch(() => ({}));
  const { data: tok } = await db.from('strava_tokens').select('*').eq('user_id', user.id).maybeSingle();
  if (!tok) return json({ error: 'strava_non_connecte' }, 400);
  // Premier import : 1 an d'historique (repères : FC max, allures…). Ensuite : 42 jours.
  const days = Math.min(Math.max(Number(body.days) || (tok.athlete?.full ? 42 : 365), 1), 365);

  let access = tok.access_token;
  if (tok.expires_at < Date.now() / 1000 + 300) {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: Deno.env.get('STRAVA_CLIENT_ID')!, client_secret: Deno.env.get('STRAVA_CLIENT_SECRET')!,
        grant_type: 'refresh_token', refresh_token: tok.refresh_token,
      }),
    });
    const t = await r.json();
    if (!r.ok || !t.access_token) return json({ error: 'rafraichissement_refuse', detail: t?.message }, 400);
    access = t.access_token;
    await db.from('strava_tokens').update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }).eq('user_id', user.id);
  }

  const after = Math.floor(Date.now() / 1000) - days * 86400;
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (r.status === 429) return json({ error: 'limite_strava', detail: 'Trop de requêtes, réessaie dans 15 min.' }, 429);
    if (!r.ok) return json({ error: 'lecture_refusee', detail: r.status }, 400);
    const list = await r.json();
    for (const a of list) {
      rows.push({
        id: a.id, user_id: user.id, start_local: a.start_date_local, start_date: a.start_date, sport_type: a.sport_type || a.type,
        name: a.name, distance: a.distance, moving_time: a.moving_time, elevation: a.total_elevation_gain, avg_speed: a.average_speed,
        avg_hr: a.average_heartrate ?? null, max_hr: a.max_heartrate ?? null, avg_watts: a.average_watts ?? null,
        suffer_score: a.suffer_score ?? null, pr_count: a.pr_count ?? 0,
      });
    }
    if (list.length < 100) break;
  }
  if (rows.length) {
    const { error } = await db.from('activities').upsert(rows);
    if (error) return json({ error: 'ecriture', detail: error.message }, 500);
  }
  // Profil Strava : poids, FTP, zones (nécessite l'autorisation profile:read_all)
  const H = { headers: { Authorization: `Bearer ${access}` } };
  const athlete: Record<string, unknown> = { ...(tok.athlete || {}), full: true };
  try {
    const ra = await fetch('https://www.strava.com/api/v3/athlete', H);
    if (ra.ok) {
      const a = await ra.json();
      Object.assign(athlete, { id: a.id, firstname: a.firstname, lastname: a.lastname, city: a.city, profile: a.profile_medium, sex: a.sex, weight: a.weight || null, ftp: a.ftp || null });
    }
    const rz = await fetch('https://www.strava.com/api/v3/athlete/zones', H);
    if (rz.ok) {
      const z = await rz.json();
      athlete.hr_zones = z.heart_rate?.zones || null; athlete.hr_custom = !!z.heart_rate?.custom_zones;
      athlete.power_zones = z.power?.zones || null; athlete.profile_scope = true;
    } else if (rz.status === 401 || rz.status === 403) athlete.profile_scope = false;
  } catch (_) { /* profil facultatif */ }
  await db.from('strava_tokens').update({ last_sync: new Date().toISOString(), athlete }).eq('user_id', user.id);
  return json({ ok: true, count: rows.length, days, profile_scope: athlete.profile_scope ?? null });
});
