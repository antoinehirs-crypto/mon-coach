// Envoi d'une séance structurée vers intervals.icu (gratuit), qui la synchronise sur la montre COROS / Garmin.
// GET                          -> { configured }
// POST {action:'save', key}    -> vérifie la clé API intervals.icu de l'utilisateur et l'enregistre (kv privé)
// POST {action:'forget'}       -> supprime la clé
// POST {date, name, description, uid} -> crée / met à jour la séance dans le calendrier intervals.icu
import { cors, json, requireUser } from '../_shared/util.ts';

const API = 'https://intervals.icu/api/v1';
const auth = (key: string) => 'Basic ' + btoa('API_KEY:' + key);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const a = await requireUser(req);
  if (a instanceof Response) return a;
  const { user, db } = a;
  const { data: row } = await db.from('kv').select('value').eq('user_id', user.id).eq('key', 'intervals').maybeSingle();
  const key: string | undefined = row?.value?.key;

  if (req.method === 'GET') return json({ configured: !!key, athlete: row?.value?.name || null });
  const body = await req.json().catch(() => ({}));

  if (body.action === 'forget') { await db.from('kv').delete().eq('user_id', user.id).eq('key', 'intervals'); return json({ ok: true }); }

  if (body.action === 'save') {
    const k = String(body.key || '').trim();
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(k)) return json({ error: 'cle_invalide' }, 400);
    const r = await fetch(`${API}/athlete/0`, { headers: { Authorization: auth(k) } });
    if (!r.ok) return json({ error: 'cle_refusee', detail: r.status }, 400);
    const ath = await r.json().catch(() => ({}));
    await db.from('kv').upsert({ user_id: user.id, key: 'intervals', value: { key: k, name: ath.name || '' }, updated_at: new Date().toISOString() });
    return json({ ok: true, athlete: ath.name || null });
  }

  if (!key) return json({ error: 'intervals_non_configure' }, 400);
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !body.description) return json({ error: 'seance_invalide' }, 400);
  const ev = {
    category: 'WORKOUT', type: body.type || 'Run', name: String(body.name || 'Séance Mon Coach').slice(0, 120),
    description: String(body.description).slice(0, 4000), start_date_local: date + 'T00:00:00',
    uid: String(body.uid || 'moncoach-' + date).slice(0, 80),
  };
  const r = await fetch(`${API}/athlete/0/events?upsertOnUid=true`, {
    method: 'POST', headers: { Authorization: auth(key), 'Content-Type': 'application/json' }, body: JSON.stringify(ev),
  });
  const t = await r.text();
  if (!r.ok) return json({ error: 'envoi_refuse', detail: t.slice(0, 300) }, 400);
  return json({ ok: true });
});
