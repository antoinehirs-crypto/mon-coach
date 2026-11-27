// Rappels sur le téléphone (appli Android) : check-in du matin et séance du plan 1 h avant.
// Programmés localement, sans serveur ; reprogrammés à chaque ouverture et à chaque changement de plan.
import { LocalNotifications } from '@capacitor/local-notifications';

const BASE = 7000; // plage d'identifiants réservée à l'appli
const hm = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? [+m[1], +m[2]] : null; };

/** Liste des rappels à venir (fonction pure, testée). */
export function plannedReminders({ plan, monday, prefs, now = Date.now(), days = 7, dayOf }) {
  const out = [];
  if (!prefs?.on) return out;
  const ci = hm(prefs.checkin || '07:30');
  for (let d = 0; d < days && ci; d++) {
    const t = new Date(now); t.setDate(t.getDate() + d); t.setHours(ci[0], ci[1], 0, 0);
    if (t.getTime() > now) out.push({ at: t.getTime(), title: 'Forme du jour', body: 'Comment as-tu dormi ? 10 secondes pour ajuster ta séance.' });
  }
  if (prefs.seances !== false && plan && monday) {
    for (let i = 0; i < 7; i++) {
      (dayOf(plan, i).seances || []).forEach((s, k) => {
        const st = hm(s.quand); if (!st || s.sport === 'repos' || plan.done?.[i + '_' + k]) return;
        const t = new Date(monday); t.setDate(t.getDate() + i); t.setHours(st[0], st[1], 0, 0);
        const at = t.getTime() - 60 * 6e4;
        if (at > now) out.push({ at, title: 'Séance dans 1 h', body: `${s.titre} · ${s.duree_min} min${s.intensite ? ' · ' + s.intensite : ''}` });
      });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 40);
}

let lastSig = '';
export async function scheduleReminders(list, askPermission = false) {
  const sig = JSON.stringify(list);
  if (sig === lastSig && !askPermission) return { ok: true };
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted' && askPermission) perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return { ok: false, reason: 'refus' };
  const pend = await LocalNotifications.getPending();
  const mine = pend.notifications.filter(n => n.id >= BASE && n.id < BASE + 100);
  if (mine.length) await LocalNotifications.cancel({ notifications: mine.map(n => ({ id: n.id })) });
  if (list.length) await LocalNotifications.schedule({ notifications: list.map((r, i) => ({ id: BASE + i, title: r.title, body: r.body, schedule: { at: new Date(r.at), allowWhileIdle: true } })) });
  lastSig = sig;
  return { ok: true, n: list.length };
}
