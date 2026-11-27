// Coach IA, 100 % gratuit par défaut, avec un ordre de repli :
//   1. Gemini 2.5 Pro (offre gratuite de Google AI Studio, GEMINI_API_KEY ; quota quotidien limité)
//   2. Gemini 2.5 Flash (même clé, quota gratuit plus large)
//   3. Groq (GROQ_API_KEY, gratuit : Llama 3.3 70B par défaut, GROQ_MODEL pour changer)
//   4. sinon l'appli garde ses règles intégrées.
// Prêt mais désactivé : Claude (API Anthropic payante, ANTHROPIC_API_KEY) passerait en premier, plafonné à
// CLAUDE_MONTHLY_USD par mois (compteur partagé, table ai_usage). Sans clé posée, il n'est jamais appelé.
// Même principe pour Gemini Pro payant : GEMINI_PRO_MONTHLY_USD plafonne la dépense si la facturation Google est activée.
// Sans aucune clé : {error:"ia_non_configuree"}.
//
import Anthropic from 'npm:@anthropic-ai/sdk';
import { cors, json, requireUser } from '../_shared/util.ts';

const RULES = `Principes non négociables :
- Entraînement polarisé (~80 % facile Z1-Z2, ~20 % intense), +10 % de volume max d'une semaine à l'autre, semaine allégée toutes les 3-4 semaines.
- Rien de dur la veille ou le jour d'un examen/partiel, ni un jour de cours chargé ; la veille d'une course : activation courte uniquement ; jour de course : rien d'autre.
- Affûtage dans les 10 jours avant une course importante : volume réduit de 30-40 %, intensité courte conservée.
- Forme basse (< 45/100), VFC basse ou fatigue (TSB < -20) : récupération.
- Respecte le créneau libre maximal et les blessures signalées.
- Footings faciles vraiment faciles (sous ~78 % FC max) : beaucoup d'athlètes courent trop vite en endurance.`;

const SYSTEM = `Tu es un entraîneur d'endurance de très haut niveau (natation, vélo, course à pied, trail, triathlon, renforcement), diplômé, qui coache des athlètes de tous niveaux. Tu raisonnes comme un vrai coach : tu lis la charge des 7 et 28 derniers jours, l'équilibre entre les sports, la fatigue, les compétitions à venir (périodisation, affûtage), les examens et l'agenda, puis tu choisis LA séance la plus utile aujourd'hui. Pas de séance générique : chaque séance a un objectif physiologique précis (endurance fondamentale, seuil, VO2max, force, technique, économie, spécifique course) que tu nommes dans « pourquoi ».
${RULES}
Format des séances :
- Toujours échauffement, corps de séance, retour au calme, durée totale = somme des blocs.
- Cibles chiffrées à partir des repères fournis (FC max, FC seuil, allure seuil, VMA, FTP, CSS). Si un repère manque, donne la cible en ressenti/RPE et en % de FC max.
- blocs : liste de groupes { repeat, steps }. repeat = 1 pour un bloc simple. Chaque step : label (court, en français), min (durée en minutes, même pour une distance), dist_m (0 si au temps), cible (texte lisible : « 4:05-4:12/km », « 238-250 W », « 1:52/100 m », « 150-160 bpm »), ref (hr | pace | ftp | css | none), lo et hi (pourcentages de la référence : % FC max pour hr, % FTP pour ftp, % de la VITESSE seuil pour pace et css, où 100 = allure seuil/CSS et 90 = plus lent ; 0 si ref = none), intensity (warmup | interval | recovery | cooldown | steady).
- Natation : distances multiples de 25 m, récupérations en secondes. Vélo : cibles en watts (% FTP). Course : allures et FC.
- Écris en français, tutoiement, phrases courtes. Le champ conseil : 1 à 2 conseils pratiques (nutrition, terrain, matériel, technique).`;

const step = { type: 'object', additionalProperties: false, required: ['label', 'min', 'dist_m', 'cible', 'ref', 'lo', 'hi', 'intensity'], properties: {
  label: { type: 'string' }, min: { type: 'number' }, dist_m: { type: 'number' }, cible: { type: 'string' },
  ref: { type: 'string', enum: ['hr', 'pace', 'ftp', 'css', 'none'] }, lo: { type: 'number' }, hi: { type: 'number' },
  intensity: { type: 'string', enum: ['warmup', 'interval', 'recovery', 'cooldown', 'steady'] } } };
const seance = { type: 'object', additionalProperties: false, required: ['niveau', 'sport', 'type', 'titre', 'intensite', 'pourquoi', 'conseil', 'blocs'], properties: {
  niveau: { type: 'string', enum: ['facile', 'moyen', 'avance'] }, sport: { type: 'string', enum: ['run', 'bike', 'swim', 'renfo', 'sport'] },
  type: { type: 'string', enum: ['facile', 'qualite', 'long', 'activation', 'recuperation'] }, titre: { type: 'string' }, intensite: { type: 'string' },
  pourquoi: { type: 'array', items: { type: 'string' } }, conseil: { type: 'string' },
  blocs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['repeat', 'steps'], properties: { repeat: { type: 'integer' }, steps: { type: 'array', items: step } } } } } };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['analyse', 'seances'], properties: { analyse: { type: 'string' }, seances: { type: 'array', items: seance } } };

function taskPrompt(body: Record<string, unknown>): string {
  const facts = JSON.stringify(body.facts || {});
  const demande = String(body.demande || '').slice(0, 600);
  if (body.task === 'modifier') {
    return `Données de l'athlète :\n${facts}\n\nSéance qu'il a choisie :\n${JSON.stringify(body.seance || {}).slice(0, 8000)}\n\nIl demande cette modification : « ${demande} »\n\nRends UNE seule séance (même niveau) modifiée selon sa demande, en gardant les principes. Si la demande est risquée (ex. séance dure la veille d'un partiel), fais-la quand même mais en version prudente et explique-le dans pourquoi. analyse : une phrase sur ce que tu as changé.`;
  }
  return `Données de l'athlète :\n${facts}\n\n${demande ? `Il demande une séance précise : « ${demande} ». Respecte sa demande (sport, type, durée) tout en appliquant les principes.` : 'Propose LA séance du jour la plus utile.'}\n\nRends exactement 3 versions de la MÊME séance (même sport, même objectif), dans l'ordre : niveau facile (plus courte et/ou moins de répétitions, pour un jour sans temps ou sans énergie), moyen (la séance conseillée), avancé (plus de volume ou de répétitions, toujours dans les principes et le créneau). Si aujourd'hui doit être du repos ou de la récupération, les 3 versions sont de la récupération active de durées différentes (renfo/mobilité possible) et tu l'expliques. analyse : 2 à 3 phrases de coach sur la situation (charge, fatigue, prochaine course) et le choix du jour.`;
}

type Res = { text: string; cost: number };
const num = (k: string, d: number) => { const v = parseFloat(Deno.env.get(k) || ''); return isFinite(v) ? v : d; };

async function viaClaude(key: string, system: string, user: string, structured: boolean): Promise<Res> {
  const client = new Anthropic({ apiKey: key });
  // deno-lint-ignore no-explicit-any
  const params: any = {
    model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-5-5',
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: structured ? 'medium' : 'low', ...(structured ? { format: { type: 'json_schema', schema: SCHEMA } } : {}) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  // deno-lint-ignore no-explicit-any
  const r: any = await (client.beta.messages as any).create(params);
  if (r.stop_reason === 'refusal') throw new Error('refus');
  // coût estimé au tarif Claude Opus 5.5 (4 $ / 20 $ par million de jetons) ; ajustable si autre modèle
  const cost = (r.usage?.input_tokens || 0) * num('CLAUDE_USD_PER_MTOK_IN', 4) / 1e6 + (r.usage?.output_tokens || 0) * num('CLAUDE_USD_PER_MTOK_OUT', 20) / 1e6;
  // deno-lint-ignore no-explicit-any
  return { text: (r.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''), cost };
}

const gemini = (model: string, inUsd: number, outUsd: number) => async (key: string, system: string, user: string, structured: boolean): Promise<Res> => {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user + (structured ? `\n\nRéponds uniquement en JSON conforme à ce schéma : ${JSON.stringify(SCHEMA)}` : '') }] }],
      generationConfig: structured ? { responseMimeType: 'application/json', temperature: 0.4 } : { temperature: 0.6 },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || String(r.status));
  const u = d.usageMetadata || {};
  const cost = (u.promptTokenCount || 0) * inUsd / 1e6 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * outUsd / 1e6;
  return { text: (d.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join(''), cost };
};

async function viaGroq(key: string, system: string, user: string, structured: boolean): Promise<Res> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user + (structured ? `\n\nRéponds uniquement en JSON conforme à ce schéma : ${JSON.stringify(SCHEMA)}` : '') }],
      temperature: structured ? 0.4 : 0.6, max_tokens: 8000,
      ...(structured ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || String(r.status));
  return { text: d.choices?.[0]?.message?.content || '', cost: 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const claudeKey = Deno.env.get('ANTHROPIC_API_KEY'), geminiKey = Deno.env.get('GEMINI_API_KEY'), groqKey = Deno.env.get('GROQ_API_KEY');
  if (!claudeKey && !geminiKey && !groqKey) return json({ error: 'ia_non_configuree' }, 200);
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));

  // quota quotidien par utilisateur
  const limit = +(Deno.env.get('AI_DAILY_LIMIT') || 25), day = new Date().toISOString().slice(0, 10);
  const { data: u } = await auth.db.from('kv').select('value').eq('user_id', auth.user.id).eq('key', 'ai_usage').maybeSingle();
  const used = u?.value?.date === day ? +u.value.n || 0 : 0;
  if (used >= limit) return json({ error: 'quota_ia', detail: `Limite de ${limit} demandes au coach IA atteinte pour aujourd'hui.` }, 429);
  await auth.db.from('kv').upsert({ user_id: auth.user.id, key: 'ai_usage', value: { date: day, n: used + 1 }, updated_at: new Date().toISOString() });

  const structured = body.task === 'seance' || body.task === 'modifier';
  let system: string, user: string;
  if (structured) { system = SYSTEM; user = taskPrompt(body); }
  else {
    user = String(body.prompt || '').slice(0, 60000);
    if (!user) return json({ error: 'prompt_vide' }, 400);
    system = 'Tu es un entraîneur d\'endurance expert (natation, vélo, course, triathlon). Conseils sportifs uniquement, jamais d\'avis médical.\n' + RULES;
  }

  // fournisseurs dans l'ordre, avec leur plafond mensuel (Infinity = pas de plafond : offre gratuite)
  const month = day.slice(0, 7);
  const tries: { name: string; key?: string; cap: number; call: (k: string, s: string, u: string, j: boolean) => Promise<Res> }[] = [
    { name: 'claude', key: claudeKey, cap: num('CLAUDE_MONTHLY_USD', 5), call: viaClaude },
    { name: 'gemini-pro', key: geminiKey, cap: num('GEMINI_PRO_MONTHLY_USD', Infinity), call: gemini(Deno.env.get('GEMINI_PRO_MODEL') || 'gemini-2.5-pro', 1.25, 10) },
    { name: 'gemini', key: geminiKey, cap: Infinity, call: gemini(Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash', 0, 0) },
    { name: 'groq', key: groqKey, cap: Infinity, call: viaGroq },
  ];
  const { data: rows, error: usageErr } = await auth.db.from('ai_usage').select('provider,calls,cost_usd').eq('month', month);
  const spent = (p: string) => +((rows || []).find((r: { provider: string }) => r.provider === p)?.cost_usd || 0);
  const errs: string[] = [];
  for (const t of tries) {
    if (!t.key || t.cap <= 0) continue;
    // fournisseur payant : on ne l'utilise que si le compteur est lisible et sous le plafond
    if (isFinite(t.cap) && (usageErr || spent(t.name) >= t.cap)) { errs.push(t.name + ' : ' + (usageErr ? 'compteur indisponible' : 'plafond du mois atteint')); continue; }
    try {
      const r = await t.call(t.key, system, user, structured || !!body.json);
      const row = (rows || []).find((x: { provider: string }) => x.provider === t.name) as { calls: number; cost_usd: number } | undefined;
      await auth.db.from('ai_usage').upsert({ month, provider: t.name, calls: (row?.calls || 0) + 1, cost_usd: +(spent(t.name) + r.cost).toFixed(4), updated_at: new Date().toISOString() });
      if (!structured) return json({ text: r.text, ia: t.name });
      const out = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      if (!Array.isArray(out.seances) || !out.seances.length) throw new Error('réponse vide');
      return json({ ...out, ia: t.name });
    } catch (e) { errs.push(t.name + ' : ' + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ error: 'ia_erreur', detail: errs.join(' · ') }, 502);
});
