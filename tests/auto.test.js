import { describe, it, expect } from 'vitest';
import { computeAuto } from '../src/auto.js';

const run = (km, min, extra = {}) => ({ sport_type: 'Run', name: 'Run', start_local: '2026-11-01T10:00:00', distance: km * 1000, moving_time: min * 60, avg_speed: km * 1000 / (min * 60), ...extra });

describe('repères automatiques', () => {
  it('FC max : écarte un pic isolé du capteur', () => {
    const r = computeAuto({ acts: [run(10, 50, { max_hr: 221 }), run(10, 50, { max_hr: 196 }), run(5, 25, { max_hr: 190 })] });
    expect(r.fcmax.n).toBe(196);
  });
  it('allure seuil plausible à partir d\'un 10 km en 45 min', () => {
    const r = computeAuto({ acts: [run(10, 45)] });
    expect(r.seuil).toBeTruthy();
    const [m, s] = r.seuil.v.split(':').map(Number);
    const sec = m * 60 + s;
    expect(sec).toBeGreaterThan(4 * 60 + 20);
    expect(sec).toBeLessThan(4 * 60 + 50);
  });
  it('aucune donnée : aucun repère inventé', () => {
    const r = computeAuto({});
    expect(Object.keys(r).filter(k => r[k])).toEqual([]);
  });
});
