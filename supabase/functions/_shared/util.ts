import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

/** Vérifie le jeton de session de l'utilisateur (les fonctions sont déployées sans verify_jwt). */
export async function requireUser(req: Request): Promise<{ user: User; db: SupabaseClient } | Response> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'non_connecte' }, 401);
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return json({ error: 'session_invalide' }, 401);
  const { data: p } = await db.from('profiles').select('status').eq('id', data.user.id).single();
  if (p?.status === 'suspendu') return json({ error: 'suspendu' }, 403);
  return { user: data.user, db };
}
