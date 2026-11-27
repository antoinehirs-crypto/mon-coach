import { describe, it, expect } from 'vitest';
import { parseICS, modeOf, EXAM } from '../src/ics.js';

const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cours1
DTSTART;TZID=Europe/Paris:20261207T083000
DTEND;TZID=Europe/Paris:20261207T103000
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4
EXDATE;TZID=Europe/Paris:20261214T083000
SUMMARY:Mécanique
LOCATION:ESILV Paris - Parc
END:VEVENT
BEGIN:VEVENT
UID:p1
DTSTART;TZID=Europe/Paris:20261212T090000
DTEND;TZID=Europe/Paris:20261212T120000
SUMMARY:Partiel d'analyse
END:VEVENT
END:VCALENDAR`;

describe('agenda iCal', () => {
  const from = new Date(2026, 11, 1).getTime(), to = new Date(2027, 1, 1).getTime();
  const evs = parseICS(ics, 'test', { from, to });
  it('déplie la récurrence hebdomadaire et retire les dates exclues', () => {
    const cours = evs.filter(e => /Mécanique/.test(e.t));
    expect(cours).toHaveLength(3);
    expect(cours.map(e => new Date(e.s).getDate())).toEqual([7, 21, 28]);
    expect(new Date(cours[0].s).getHours()).toBe(8);
  });
  it('repère les partiels', () => {
    expect(evs.some(e => EXAM.test(e.t))).toBe(true);
  });
  it('présentiel ou visio', () => {
    expect(modeOf('Cours', 'ESILV Paris - Parc')).toBe('site');
    expect(modeOf('Cours', 'ESILV (en ligne)')).toBe('visio');
  });
});
