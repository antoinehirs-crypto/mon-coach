import { describe, it, expect } from 'vitest';
import { buildPlan, DAYS } from '../src/planner.js';

// Semaine du lundi 7 décembre 2026
const week = (over = {}) => DAYS.map((_, i) => ({
  date: `2026-12-${String(7 + i).padStart(2, '0')}`, charge: 'normale', examens: [], veille_examen: [], ...(over[i] || {}),
}));
const tri = { sports: ['Triathlon'], niveau: 'Intermédiaire', heures: 8, refs: { fcmax: 195, seuil: '4:30', ftp: 230, css: '1:45' } };
const dur = j => j.seances.reduce((t, s) => t + (+s.duree_min || 0), 0);
const hard = j => j.seances.some(s => s.type === 'qualite' || s.dur);

describe('planificateur', () => {
  it('produit 7 jours avec au moins une séance chacun (repos compris)', () => {
    const p = buildPlan({ profile: tri, days: week() });
    expect(p.jours).toHaveLength(7);
    p.jours.forEach(j => expect(j.seances.length).toBeGreaterThan(0));
  });

  it('polarisé : 2 séances clés au maximum, jamais deux jours de suite', () => {
    for (let w = 0; w < 8; w++) {
      const days = week().map(d => ({ ...d, date: new Date(new Date(d.date).getTime() + w * 7 * 864e5).toISOString().slice(0, 10) }));
      const p = buildPlan({ profile: tri, days });
      const idx = p.jours.map((j, i) => (hard(j) ? i : -1)).filter(i => i >= 0);
      expect(idx.length).toBeLessThanOrEqual(2);
      for (let k = 1; k < idx.length; k++) expect(idx[k] - idx[k - 1]).toBeGreaterThan(1);
    }
  });

  it("rien de dur le jour ni la veille d'un examen", () => {
    const p = buildPlan({ profile: tri, days: week({ 1: { veille_examen: ['Partiel'] }, 2: { examens: ['Partiel maths'] } }) });
    expect(hard(p.jours[1])).toBe(false);
    expect(hard(p.jours[2])).toBe(false);
    p.jours[1].seances.forEach(s => expect(+s.duree_min || 0).toBeLessThanOrEqual(45));
  });

  it("jour d'examen : repos", () => {
    const p = buildPlan({ profile: tri, days: week({ 3: { examens: ['Partiel'] } }) });
    expect(p.jours[3].seances.every(s => s.sport === 'repos')).toBe(true);
  });

  it('respecte le plafond de minutes (+10 % max)', () => {
    const p = buildPlan({ profile: tri, days: week(), rule: { minutes_max: 300 } });
    const total = p.jours.reduce((t, j) => t + dur(j), 0);
    expect(total).toBeLessThanOrEqual(300 * 1.1);
  });

  it('petit volume : ne dépasse pas le plafond même avec les durées minimales', () => {
    for (const m of [150, 200, 240]) {
      const p = buildPlan({ profile: tri, days: week(), rule: { minutes_max: m } });
      expect(p.jours.reduce((t, j) => t + dur(j), 0)).toBeLessThanOrEqual(m * 1.1);
    }
  });

  it('semaine allégée : nettement moins de volume', () => {
    const normal = buildPlan({ profile: tri, days: week(), rule: { minutes_max: 480 } });
    const light = buildPlan({ profile: tri, days: week(), rule: { minutes_max: 480, allegee_obligatoire: true } });
    const t = p => p.jours.reduce((a, j) => a + dur(j), 0);
    expect(light.allegee).toBe(true);
    expect(t(light)).toBeLessThan(t(normal) * 0.85);
  });

  it('semaine de course : allégée automatiquement', () => {
    const p = buildPlan({ profile: { ...tri, date: '2026-12-13' }, days: week() });
    expect(p.allegee).toBe(true);
  });

  it('ne place rien les jours non disponibles', () => {
    const p = buildPlan({ profile: { ...tri, jours: ['Mardi', 'Jeudi', 'Samedi', 'Dimanche'] }, days: week() });
    [0, 2, 4].forEach(i => expect(p.jours[i].seances.every(s => s.sport === 'repos')).toBe(true));
  });

  it('coureur seul : uniquement de la course (et du renfo)', () => {
    const p = buildPlan({ profile: { sports: ['Course à pied'], niveau: 'Débutant', heures: 4 }, days: week() });
    p.jours.flatMap(j => j.seances).forEach(s => expect(['run', 'renfo', 'repos']).toContain(s.sport));
  });
});
