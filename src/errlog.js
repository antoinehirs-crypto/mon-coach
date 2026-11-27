// Journal des erreurs : ce qui plante chez un utilisateur arrive dans l'espace admin (table client_errors).
// Hors ligne, les erreurs attendent dans le téléphone et partent au retour du réseau.
// Une même erreur n'est envoyée qu'une fois par session, 20 au maximum.

const KEY = 'mc_errlog_queue';
const seen = new Set();
let client = null, userId = () => null, version = '', sent = 0;

const queue = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
const store = q => { try { localStorage.setItem(KEY, JSON.stringify(q.slice(-30))); } catch (e) { } };

export function short(e) {
  if (!e) return 'Erreur inconnue';
  if (typeof e === 'string') return e;
  return e.message || e.error_description || e.error || e.msg || JSON.stringify(e).slice(0, 300);
}

export async function flushErrors() {
  const uid = userId();
  if (!client || !uid || !navigator.onLine) return;
  const q = queue(); if (!q.length) return;
  store([]);
  const { error } = await client.from('client_errors').insert(q.map(x => ({ ...x, user_id: uid })));
  // Table absente (schéma pas encore appliqué) : on abandonne ces erreurs plutôt que de réessayer sans fin.
  if (error && !/PGRST205|42P01/.test(error.code || '')) store([...queue(), ...q]);
}

export function logError(lieu, e) {
  try {
    const message = short(e).slice(0, 500);
    const k = lieu + '|' + message;
    if (seen.has(k) || sent >= 20) return;
    seen.add(k); sent++;
    console.warn('[Mon Coach]', lieu, e);
    store([...queue(), { lieu, message, stack: String(e?.stack || '').slice(0, 2000), version, appareil: navigator.userAgent.slice(0, 200), at: new Date().toISOString() }]);
    flushErrors();
  } catch (x) { }
}

export function initErrorLog(sb, getUserId, ver) {
  client = sb; userId = getUserId; version = ver || '';
  addEventListener('error', ev => {
    // Ignore les erreurs de scripts tiers sans détail (« Script error. »)
    if (!ev.error && /^Script error/.test(ev.message || '')) return;
    logError('page', ev.error || ev.message);
  });
  addEventListener('unhandledrejection', ev => logError('promesse', ev.reason));
  addEventListener('online', flushErrors);
}
