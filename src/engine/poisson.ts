import type { Rng } from './rng';

/** Muestra de una Poisson(λ) con el algoritmo de Knuth (adecuado para λ chicos, como en futsal). */
export function samplePoisson(lambda: number, rng: Rng): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

/** P(X = k) para X ~ Poisson(λ). */
export function poissonPmf(k: number, lambda: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

/**
 * Probabilidades exactas de victoria local / empate / visitante para dos Poisson
 * independientes. Útil para mostrar "chances" en la previa sin simular.
 */
export function outcomeProbabilities(lh: number, la: number, maxGoals = 20) {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= maxGoals; i++) {
    const pi = poissonPmf(i, lh);
    for (let j = 0; j <= maxGoals; j++) {
      const p = pi * poissonPmf(j, la);
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }
  return { home, draw, away };
}
