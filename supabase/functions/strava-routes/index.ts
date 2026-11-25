// Itinéraires enregistrés dans Strava (créés avec le générateur d'itinéraires Strava, abonnement requis pour la création).
// GET              -> { routes: [{ id, name, km, dplus, type, private, starred }] }
// POST {id}        -> { gpx } (fichier GPX de l'itinéraire)
// L'API Strava ne permet pas de générer un itinéraire : on lit seulement ceux que l'athlète a créés ou mis en favori.
import { cors, json, requireUser } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { user, db } = auth;
  const { data: tok } = await db.from('strava_tokens').select('*').eq('user_id', user.id).maybeSingle();
  if (!tok) return json({ error: 'strava_non_connecte' }, 400);

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
  const H = { headers: { Authorization: `Bearer ${access}` } };

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!/^\d+$/.test(id)) return json({ error: 'id_invalide' }, 400);
    const r = await fetch(`https://www.strava.com/api/v3/routes/${id}/export_gpx`, H);
    if (!r.ok) return json({ error: 'export_refuse', detail: r.status }, r.status === 429 ? 429 : 400);
    return json({ gpx: await r.text() });
  }

  const athleteId = tok.athlete_id || tok.athlete?.id;
  if (!athleteId) return json({ error: 'athlete_inconnu' }, 400);
  const r = await fetch(`https://www.strava.com/api/v3/athletes/${athleteId}/routes?per_page=100`, H);
  if (r.status === 429) return json({ error: 'limite_strava' }, 429);
  if (!r.ok) return json({ error: 'lecture_refusee', detail: r.status }, 400);
  const list = await r.json();
  const routes = (Array.isArray(list) ? list : []).map((x: Record<string, any>) => ({
    id: x.id_str || String(x.id), name: x.name, km: +(x.distance / 1000).toFixed(1), dplus: Math.round(x.elevation_gain || 0),
    type: x.type === 2 ? 'run' : x.type === 1 ? 'ride' : 'autre', private: !!x.private, starred: !!x.starred,
  }));
  return json({ routes });
});
