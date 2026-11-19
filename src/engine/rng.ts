// Generador pseudoaleatorio con semilla (mulberry32). Su estado es un solo entero,
// así se guarda en GameState.rngState y la partida es reproducible.

export interface Rng {
  /** Float en [0, 1). */
  next(): number;
  /** Entero en [a, b] inclusive. */
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  id(): string;
  /** Estado actual, para persistir. */
  state(): number;
}

export function createRng(state: number): Rng {
  let s = state >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a, b) => Math.floor(next() * (b - a + 1)) + a,
    pick: (arr) => {
      if (arr.length === 0) throw new Error('pick() sobre lista vacía');
      return arr[Math.floor(next() * arr.length)];
    },
    chance: (p) => next() < p,
    id: () => Math.floor(next() * 2 ** 32).toString(36).padStart(7, '0'),
    state: () => s,
  };
}

export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}

/** Copia mezclada (Fisher-Yates) con el rng de la partida. */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
