import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const configured = !!(SUPABASE_URL && SUPABASE_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;

/** Appelle une fonction serveur Supabase avec la session de l'utilisateur. */
export async function fn(name, { method = 'POST', body, query } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const url = `${SUPABASE_URL}/functions/v1/${name}${query ? '?' + new URLSearchParams(query) : ''}`;
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e = new Error(d.detail ? `${d.error} (${typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)})` : d.error || `HTTP ${r.status}`); e.code = d.error; throw e; }
  return d;
}
