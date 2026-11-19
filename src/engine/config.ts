// Constantes de balance en un solo lugar. Calibradas por src/engine/match.test.ts.

export const MATCH = {
  /** Minutos de juego (2 tiempos de 20). */
  minutes: 40,
  /** Goles esperados por equipo con fuerzas iguales y sin ventaja local (futsal: ~5-6 por partido). */
  baseGoalsPerTeam: 2.8,
  /** Sensibilidad de los goles esperados a la diferencia de fuerza: λ = μ·exp(k·Δ). */
  strengthSensitivity: 0.045,
  /** Ventaja de jugar de local, en puntos de fuerza. */
  homeAdvantage: 3,
  /** Límites de λ para evitar resultados absurdos. */
  minLambda: 0.3,
  maxLambda: 9,
  /** Eventos de color (no gol) por equipo y partido, como tasas de Poisson. */
  chancesPerTeam: 5,
  savesPerTeam: 3,
  foulsPerTeam: 4,
  buildsPerTeam: 3,
  /** Parte de las faltas que terminan en tarjeta. Calibradas para igualar la tasa del original
   * (HTML 724-762: ~0,145 amarillas y 0,015 rojas por titular y partido => ~0,7 y ~0,08 por equipo). */
  yellowCardShare: 0.18,
  redCardShare: 0.02,
  /** Probabilidad de convertir un penal: base y ajuste por diferencia pateador-arquero. */
  penaltyBase: 0.75,
  penaltySensitivity: 0.006,
} as const;

export const LEAGUE = {
  teamsPerDivision: 18,
  pointsWin: 3,
  pointsDraw: 1,
} as const;

/** Disciplina. Port de processCards (HTML 724-762). */
export const DISCIPLINE = {
  /** Amarillas acumuladas que fuerzan un partido de suspensión (HTML 740). */
  yellowLimit: 4,
  /** Partidos de suspensión por roja (HTML 733: Math.max(suspended, 1)). */
  redSuspension: 1,
} as const;

/** Lesiones. Port de checkInjuries / INJURY_TYPES (HTML 687-706). */
export const INJURY = {
  /** Probabilidad base por partido para un titular (HTML 691-692). */
  baseChance: 0.03,
  baseChanceGk: 0.015,
  /** Multiplicador si la fatiga supera `fatigueThreshold` (HTML 694). */
  fatigueThreshold: 75,
  fatigueMult: 1.6,
  /** Cada nivel de médico acorta la lesión un 12% (HTML 700). */
  medicalReduction: 0.12,
  types: [
    { name: 'contractura muscular', weight: 40, min: 1, max: 2 },
    { name: 'desgarro muscular', weight: 28, min: 2, max: 4 },
    { name: 'esguince de tobillo', weight: 20, min: 3, max: 5 },
    { name: 'rotura de ligamentos', weight: 7, min: 6, max: 10 },
    { name: 'fractura', weight: 5, min: 7, max: 12 },
  ],
} as const;

/** Fatiga a partir de la cual un jugador no puede ser titular (HTML 776-802: FATIGUE_BLOCK). */
export const FATIGUE_BLOCK = 90;

/** Plantel y contratos (HTML 318-367). */
export const SQUAD = {
  /** Mínimo para poder despedir (HTML 344: no se despide con 6 o menos). */
  minAfterFire: 6,
  /** Mínimo con el que arranca cada temporada (se completa con juveniles). */
  minSeason: 10,
  max: 20,
  maxContractYears: 5,
  renewCostShare: 0.25,
} as const;

/** Retiros. Port de HTML 2027-2031. */
export const RETIREMENT = {
  /** Edad desde la que puede retirarse. */
  fromAge: 32,
  /** Edad en la que se retira sí o sí. */
  forcedAge: 40,
  /** Probabilidad = (edad - 31) * 0,1. */
  perYear: 0.1,
} as const;

/** Forma: límites. */
export const FORM = { min: -5, max: 5 } as const;
