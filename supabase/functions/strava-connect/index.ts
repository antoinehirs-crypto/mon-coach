// GET  ?action=url&redirect=<url>  -> URL d'autorisation Strava (client_id public)
// POST {code}                        -> échange le code, stocke les jetons
// POST {action:"disconnect"}         -> révoque et supprime
import { cors, json, requireUser } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const clientId = Deno.env.get('STRAVA_CLIENT_ID');
  const secret = Deno.env.get('STRAVA_CLIENT_SECRET');
  if (!clientId || !secret) return json({ error: 'strava_non_configure' }, 500);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const { user, db } = auth;

  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('action') === 'url') {
    const redirect = url.searchParams.get('redirect') || '';
    const u = new URL('https://www.strava.com/oauth/authorize');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('approval_prompt', url.searchParams.get('force') ? 'force' : 'auto');
    u.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
    u.searchParams.set('state', 'strava');
    return json({ url: u.toString() });
  }

  if (req.method === 'GET') {
    const { data } = await db.from('strava_tokens').select('athlete,last_sync').eq('user_id', user.id).maybeSingle();
    return json({ connected: !!data, athlete: data?.athlete ?? null, last_sync: data?.last_sync ?? null });
  }

  const body = await req.json().catch(() => ({}));
  if (body.action === 'disconnect') {
    const { data } = await db.from('strava_tokens').select('access_token').eq('user_id', user.id).maybeSingle();
    if (data) await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', body: new URLSearchParams({ access_token: data.access_token }) }).catch(() => {});
    await db.from('strava_tokens').delete().eq('user_id', user.id);
    await db.from('activities').delete().eq('user_id', user.id);
    return json({ ok: true });
  }

  if (!body.code) return json({ error: 'code_manquant' }, 400);
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, code: body.code, grant_type: 'authorization_code' }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    // Cas fréquent : appli Strava encore limitée à 1 athlète (demander l'augmentation à Strava)
    return json({ error: 'echange_refuse', detail: t?.message || t?.errors || r.status }, 400);
  }
  const a = t.athlete || {};
  await db.from('strava_tokens').upsert({
    user_id: user.id, athlete_id: a.id, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
    athlete: { id: a.id, firstname: a.firstname, lastname: a.lastname, city: a.city, profile: a.profile_medium },
  });
  return json({ ok: true, athlete: { firstname: a.firstname, lastname: a.lastname } });
});
