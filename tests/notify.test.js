import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));
const { plannedReminders } = await import('../src/notify.js');

const dayOf = (p, i) => p.jours[i] || { seances: [] };
const plan = { jours: [{ seances: [{ titre: 'Footing 45 min', sport: 'run', duree_min: 45, intensite: 'Z2', quand: '18:00-18:45' }] }, { seances: [{ sport: 'repos' }] }], done: {} };
const monday = new Date(2026, 11, 7);

describe('rappels', () => {
  it('désactivés : aucun rappel', () => {
    expect(plannedReminders({ plan, monday, prefs: { on: false }, dayOf })).toEqual([]);
  });
  it('check-in chaque matin à venir et séance 1 h avant', () => {
    const now = new Date(2026, 11, 7, 8, 0).getTime();
    const r = plannedReminders({ plan, monday, prefs: { on: true, checkin: '07:30' }, now, dayOf });
    const ses = r.filter(x => x.title === 'Séance dans 1 h');
    expect(ses).toHaveLength(1);
    expect(new Date(ses[0].at).getHours()).toBe(17);
    expect(r.filter(x => x.title === 'Forme du jour')).toHaveLength(6); // pas celui de 7 h 30, déjà passé
  });
  it('pas de rappel pour une séance déjà faite', () => {
    const now = new Date(2026, 11, 7, 8, 0).getTime();
    const r = plannedReminders({ plan: { ...plan, done: { '0_0': { rpe: 4 } } }, monday, prefs: { on: true, seances: true }, now, dayOf });
    expect(r.some(x => x.title === 'Séance dans 1 h')).toBe(false);
  });
});
