import { describe, it, expect } from 'vitest';
import { makeSession } from '../src/sessions.js';

const total = steps => steps.reduce((t, s) => t + (s.repeat ? s.repeat * total(s.steps) : s.min), 0);
const refs = { fcmax: 195, seuil: '4:30', ftp: 230, css: '1:45' };
const kinds = ['run', 'bike', 'swim'], types = ['facile', 'qualite', 'long'], levels = ['Débutant', 'Intermédiaire', 'Confirmé'];

describe('séances chiffrées', () => {
  for (const k of kinds) for (const t of types) it(`${k} ${t} : durée = somme des blocs, échauffement et retour au calme`, () => {
    for (const lvl of levels) for (const min of [30, 45, 60, 90, 150]) for (let seed = 0; seed < 6; seed++) {
      const s = makeSession(k, t, min, refs, lvl, seed);
      expect(s.sport).toBe(k);
      expect(s.steps?.length).toBeGreaterThanOrEqual(3);
      expect(s.duree_min).toBe(Math.round(total(s.steps)));
      expect(s.detail).toMatch(/Échauffement/);
      expect(s.detail).toMatch(/Retour au calme/);
      expect(s.detail).toContain(`Durée totale : ${s.duree_min} min`);
      expect(s.duree_min).toBeGreaterThan(0);
    }
  });

  it('sans repères : cibles en % ou au ressenti, jamais « NaN » ni « undefined »', () => {
    for (const k of kinds) for (const t of types) {
      const s = makeSession(k, t, 60, {}, '', 1);
      expect(s.detail).not.toMatch(/NaN|undefined|null/);
      expect(s.icu || '').not.toMatch(/NaN|undefined|null/);
    }
  });

  it('avec repères : watts et bpm calculés', () => {
    expect(makeSession('bike', 'qualite', 60, refs, 'Intermédiaire', 0).detail).toMatch(/\d+-\d+ W/);
    expect(makeSession('run', 'facile', 45, refs, 'Intermédiaire', 0).detail).toMatch(/\d+-\d+ bpm/);
  });
});
