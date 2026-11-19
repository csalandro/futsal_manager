import { describe, expect, it } from 'vitest';
import { doubleRoundRobin, roundRobin } from './schedule';

const ids = Array.from({ length: 18 }, (_, i) => `t${i}`);

describe('calendario', () => {
  it('ida y vuelta: 34 fechas, 34 partidos por equipo, 17 de local', () => {
    const rounds = doubleRoundRobin(ids);
    expect(rounds).toHaveLength(34);
    for (const id of ids) {
      const games = rounds.flat().filter(([h, a]) => h === id || a === id);
      expect(games).toHaveLength(34);
      expect(games.filter(([h]) => h === id)).toHaveLength(17);
    }
  });

  it('nadie juega dos veces en la misma fecha', () => {
    for (const round of doubleRoundRobin(ids)) {
      const seen = round.flatMap(([h, a]) => [h, a]);
      expect(new Set(seen).size).toBe(seen.length);
      expect(round).toHaveLength(9);
    }
  });

  it('cada par se enfrenta una vez por rueda', () => {
    const pairs = roundRobin(ids).flat().map(([h, a]) => [h, a].sort().join('-'));
    expect(new Set(pairs).size).toBe((18 * 17) / 2);
  });
});
