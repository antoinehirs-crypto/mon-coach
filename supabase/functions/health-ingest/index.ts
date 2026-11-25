// Réception des données santé envoyées par le Raccourci iPhone (ou tout autre outil).
// POST, en-tête x-ingest-token: <jeton personnel affiché dans l'appli>
// Corps : {date?: "2026-11-25", sleep_hours? | sleep_min?, hrv_ms?, resting_hr?, deep_min?, rem_min?, source?}
// ou une liste de ces objets.
import { admin, cors, json } from '../_shared/util.ts';

const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST attendu' }, 405);
  const token = req.headers.get('x-ingest-token') || new URL(req.url).searchParams.get('token') || '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'jeton_manquant' }, 401);
  const db = admin();
  const { data: p } = await db.from('profiles').select('id,status').eq('ingest_token', token).maybeSingle();
  if (!p || p.status === 'suspendu') return json({ error: 'jeton_invalide' }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'json_invalide' }, 400);
  const items = Array.isArray(body) ? body : [body];
  const today = new Date().toISOString().slice(0, 10);
  const rows = items.slice(0, 60).map((b: Record<string, unknown>) => {
    const sh = num(b.sleep_hours), sm = num(b.sleep_min);
    const row: Record<string, unknown> = {
      user_id: p.id,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : today,
      source: String(b.source || 'iphone').slice(0, 40),
      updated_at: new Date().toISOString(),
    };
    const sleep = sm ?? (sh != null ? Math.round(sh * 60) : null);
    if (sleep != null) row.sleep_min = sleep;
    for (const k of ['deep_min', 'rem_min', 'hrv_ms', 'resting_hr']) { const v = num(b[k]); if (v != null) row[k] = v; }
    return row;
  });
  const { error } = await db.from('health_daily').upsert(rows);
  if (error) return json({ error: 'ecriture', detail: error.message }, 500);
  return json({ ok: true, jours: rows.length });
});
