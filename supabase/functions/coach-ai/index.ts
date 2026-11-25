// Coach IA facultatif, gratuit avec une clé Google Gemini (aistudio.google.com).
// POST {prompt, json?: boolean} -> {text}
// Sans clé GEMINI_API_KEY, renvoie {error:"ia_non_configuree"} et l'appli utilise son planificateur intégré.
import { cors, json, requireUser } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'ia_non_configuree' }, 200);
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || '').slice(0, 60000);
  if (!prompt) return json({ error: 'prompt_vide' }, 400);
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: body.json ? { responseMimeType: 'application/json', temperature: 0.4 } : { temperature: 0.6 },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: 'ia_erreur', detail: d?.error?.message || r.status }, r.status === 429 ? 429 : 502);
  const text = (d.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
  return json({ text });
});
