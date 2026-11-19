import { describe, expect, it } from 'vitest';
import type { DivisionId } from '../domain/types';
import { createNewGame } from './generate';
import { isSeasonOver, playMatchday, startNewSeason, userNextFixture } from './season';
import { standings } from './standings';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

function playAll(state: ReturnType<typeof createNewGame>) {
  let guard = 0;
  while (!isSeasonOver(state) && guard++ < 100) playMatchday(state);
}

describe('partida y temporada', () => {
  it('createNewGame es determinista con la misma semilla', () => {
    expect(createNewGame(2024, 'DT')).toEqual(createNewGame(2024, 'DT'));
    expect(createNewGame(1, 'DT')).not.toEqual(createNewGame(2, 'DT'));
  });

  it('estructura inicial: 3 divisiones de 18 equipos, números únicos y nombres únicos', () => {
    const s = createNewGame(5, 'DT');
    const names = new Set<string>();
    for (const d of DIVS) {
      expect(s.divisions[d].teams).toHaveLength(18);
      expect(s.divisions[d].schedule).toHaveLength(34);
      for (const t of s.divisions[d].teams) {
        names.add(t.name);
        expect(new Set(t.squad.map((p) => p.number)).size).toBe(t.squad.length);
        expect(t.lineup.every(Boolean)).toBe(true);
      }
    }
    expect(names.size).toBe(54);
  });

  it('jugar todas las fechas termina la temporada con puntos coherentes', () => {
    const s = createNewGame(11, 'DT');
    s.userDivision = 'A';
    s.userTeamId = s.divisions.A.teams[0].id;
    expect(userNextFixture(s)).not.toBeNull();
    playAll(s);
    expect(isSeasonOver(s)).toBe(true);
    expect(userNextFixture(s)).toBeNull();
    for (const d of DIVS) {
      const div = s.divisions[d];
      expect(div.results).toHaveLength(34);
      let pts = 0, gf = 0, ga = 0;
      for (const t of div.teams) {
        expect(t.record.played).toBe(34);
        expect(t.record.w + t.record.d + t.record.l).toBe(34);
        pts += t.record.pts;
        gf += t.record.gf;
        ga += t.record.ga;
      }
      const draws = div.results.flat().filter((r) => r.hg === r.ag).length;
      const total = 18 * 17;
      expect(pts).toBe(3 * (total - draws) + 2 * draws);
      expect(gf).toBe(ga);
    }
    expect(s.news.length).toBeGreaterThan(0);
    expect(s.news.length).toBeLessThanOrEqual(30);
  });

  it('startNewSeason mantiene 18 equipos por división y aplica los ascensos y descensos del original', () => {
    const s = createNewGame(21, 'DT');
    playAll(s);
    const before = Object.fromEntries(DIVS.map((d) => [d, standings(s.divisions[d].teams).map((t) => t.id)]));
    const up = { B: [s.divisions.B.promotedDirect!, s.divisions.B.playoff!.winner!], C: [s.divisions.C.promotedDirect!, s.divisions.C.playoff!.winner!] };
    startNewSeason(s);
    const after = Object.fromEntries(DIVS.map((d) => [d, new Set(s.divisions[d].teams.map((t) => t.id))]));
    for (const d of DIVS) expect(after[d].size).toBe(18);
    expect(before.A.slice(-2).every((id) => after.B.has(id))).toBe(true);
    expect(before.B.slice(-2).every((id) => after.C.has(id))).toBe(true);
    expect(up.B.every((id) => after.A.has(id))).toBe(true);
    expect(up.C.every((id) => after.B.has(id))).toBe(true);
    expect(before.B[0]).toBe(up.B[0]); // el campeón de la liga asciende directo
    expect(s.season).toBe(2);
    for (const d of DIVS) {
      const div = s.divisions[d];
      expect(div.matchday).toBe(0);
      expect(div.results).toEqual([]);
      expect(div.schedule).toHaveLength(34);
      for (const t of div.teams) {
        expect(t.record.played).toBe(0);
        expect(t.squad.length).toBeGreaterThanOrEqual(10);
        expect(t.lineup.every(Boolean)).toBe(true);
      }
    }
    expect(isSeasonOver(s)).toBe(false);
  });

  it('la progresión es gradual: ningún jugador salta a su potencial de golpe', () => {
    const s = createNewGame(33, 'DT');
    const ratings = new Map(
      DIVS.flatMap((d) => s.divisions[d].teams.flatMap((t) => t.squad.map((p) => [p.id, p.rating] as const))),
    );
    playAll(s);
    startNewSeason(s);
    for (const d of DIVS) {
      for (const t of s.divisions[d].teams) {
        for (const p of t.squad) {
          const old = ratings.get(p.id);
          if (old !== undefined) expect(Math.abs(p.rating - old)).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
