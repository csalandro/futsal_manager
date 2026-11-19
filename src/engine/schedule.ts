// Calendario round-robin (método del círculo). Port de genSchedule / genDoubleSchedule del HTML original.
import type { Fixture } from '../domain/types';

export function roundRobin(ids: string[]): Fixture[][] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2 !== 0) list.push(null);
  const n = list.length;
  const rounds: Fixture[][] = [];
  const fixed = list[0];
  const rotating = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const arr = [fixed, ...rotating];
    const matches: Fixture[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) matches.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(matches);
    rotating.unshift(rotating.pop() as string | null);
  }
  return rounds;
}

/** Ida y vuelta: la segunda rueda repite las fechas con la localía invertida. */
export function doubleRoundRobin(ids: string[]): Fixture[][] {
  const first = roundRobin(ids);
  const second = first.map((round) => round.map(([h, a]): Fixture => [a, h]));
  return [...first, ...second];
}
