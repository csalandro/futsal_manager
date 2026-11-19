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
  yellowCardShare: 0.25,
  redCardShare: 0.05,
  /** Probabilidad de convertir un penal: base y ajuste por diferencia pateador-arquero. */
  penaltyBase: 0.75,
  penaltySensitivity: 0.006,
} as const;

export const LEAGUE = {
  teamsPerDivision: 18,
  pointsWin: 3,
  pointsDraw: 1,
} as const;
