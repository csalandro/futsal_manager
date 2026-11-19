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

/** Economía del club. Port de HTML 492-606 y 3988-3994. */
export const ECONOMY = {
  /** Precio base de la entrada por división (HTML 519: DIV_BASE_TICKET_PRICE). */
  baseTicketPrice: { A: 14, B: 9, C: 6 },
  /** Precio por defecto si no hay división (HTML 533: TICKET_PRICE). */
  fallbackTicketPrice: 8,
  /** Límites del precio que puede fijar el usuario (HTML 535). */
  ticketMin: 1,
  ticketMax: 60,
  /** Asistencia (HTML 518-532): tasa base = 0,5 + azar·0,4; moral ±; bono por división; clásico; precio. */
  attendance: {
    baseRate: 0.5,
    randomRate: 0.4,
    moralePivot: 50,
    moraleDivisor: 400,
    divisionBonus: { A: 0.14, B: 0.05, C: 0 },
    rivalBonus: 0.18,
    priceSensitivity: 0.35,
    minRate: 0.08,
    maxRate: 1,
  },
  /** Mantenimiento del estadio por fecha: 8% de la capacidad (HTML 574). */
  maintenancePerSeat: 0.08,
  /** Sueldo de jugador por fecha (HTML 492-496): rating²·1,1/100 + prima desde 72. */
  wageFactor: 1.1,
  wagePremiumFrom: 72,
  wagePremiumPerPoint: 14,
  /** Sueldo de cada empleado del staff por fecha. NO está en el original (ahí se paga solo al contratar). */
  staffWage: 60,
  /** Auspiciante de origen (HTML 483: rnd(400,1800)). */
  startSponsor: { min: 400, max: 1800, name: 'Auspiciante local' },
  /** Ofertas de auspicio (HTML 542-549). */
  sponsorOffer: {
    baseMin: 400,
    baseMax: 3200,
    baseRatingFactor: 20,
    /** [piso, rango] del multiplicador de `perMatch`; y [piso, rango] del bono (0 = sin bono). */
    tiers: [
      { perMatch: [0.8, 0.2], bonus: [15, 10] },
      { perMatch: [1.0, 0.2], bonus: [0, 0] },
      { perMatch: [0.5, 0.15], bonus: [40, 20] },
    ],
    names: [
      'Supermercados Norte', 'Neumáticos Rivera', 'Constructora del Sur', 'Banco Alfa', 'Cervecería del Puerto',
      'Automotores Central', 'Textil Andina', 'Distribuidora La Unión', 'Ferretería Belgrano', 'Seguros Patagonia',
      'Lácteos San Martín', 'Combustibles Costa', 'Inmobiliaria Vista', 'Electrodomésticos Rex', 'Panificados El Trigal',
    ],
  },
  /** Fechas seguidas en rojo para que la directiva restrinja los gastos (HTML 562). */
  lockoutThreshold: 5,
  /** Movimientos que se guardan en el historial: el usuario y la computadora. */
  logSizeUser: 60,
  logSizeCpu: 15,
} as const;

/** Ampliaciones de estadio (HTML 593-597): costo = capacidad · mult, redondeado a 10. */
export const STADIUM_UPGRADES = [
  { key: 'small', label: 'Ampliación chica', add: 150, mult: 5 },
  { key: 'medium', label: 'Ampliación mediana', add: 400, mult: 12 },
  { key: 'large', label: 'Ampliación grande', add: 900, mult: 24 },
] as const;
export type StadiumUpgradeKey = (typeof STADIUM_UPGRADES)[number]['key'];
export const STADIUM_NAME_MAX = 30; // HTML 3957: maxlength="30"

/** Empleados (HTML 3988-3994). Costo de contratar = 5000 + 3500 · cantidad actual (HTML 3998). */
export const STAFF = {
  hireBase: 5000,
  hireStep: 3500,
  /** Preparadores: el equipo arranca con 1 (HTML 484) y no se puede quedar sin ninguno. */
  minTrainers: 1,
  /** Cada fisio acelera 15% la recuperación del cansancio en el banco (HTML 781). */
  medicRecovery: 0.15,
  defs: [
    { key: 'trainers', label: 'Preparador físico', max: 7, note: 'Cada uno entrena a 3 jugadores en simultáneo (el entrenamiento llega en un próximo bloque).' },
    { key: 'medics', label: 'Fisioterapeuta', max: 3, note: 'Acelera un 15% por fisio la recuperación del cansancio de los que no juegan.' },
    { key: 'doctors', label: 'Médico', max: 3, note: 'Acorta un 12% por médico el tiempo de recuperación de los lesionados.' },
    { key: 'scouts', label: 'Ojeador', max: 3, note: 'Mejora la calidad de los juveniles de la cantera (llega en un próximo bloque).' },
    { key: 'youthCoaches', label: 'Entrenador de juveniles', max: 2, note: 'Acelera el desarrollo de la cantera (llega en un próximo bloque).' },
  ],
} as const;
