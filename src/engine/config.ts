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

/**
 * Mercado de pases. Un "día" es una fecha de liga: día = matchday + 1 de la liga (las 3 divisiones avanzan juntas;
 * HTML 4086-4096: `day = matchday + 1`). La pretemporada son semanas previas a la fecha 1, sin partidos.
 */
export const MARKET = {
  /** Semanas de pretemporada al inicio de cada temporada (HTML 1264, 2066). */
  preseasonWeeks: 2,
  /** Ventanas de pases en días de liga, inclusive (HTML 4090: `day<=3 || (day>=16 && day<=19)`). */
  windows: [
    { id: 'early', from: 1, to: 3 },
    { id: 'mid', from: 16, to: 19 },
  ],
  /** Agentes libres por ventana y su calidad (HTML 4106-4114): 12% de estrellas 70-84, el resto 46-66. */
  freeAgentCount: 8,
  freeAgentStarChance: 0.12,
  freeAgentStar: [70, 84],
  freeAgentRegular: [46, 66],
  /** Jugadores de otros clubes ofrecidos en cada fecha (HTML 4160-4172: 8 al azar, sin el único arquero). */
  clubListingCount: 8,
  /** Precio de un jugador de otro club: valor × 1,15 (HTML 4207, 4258, 4357). Los agentes libres cuestan su valor. */
  clubPriceMult: 1.15,
  /** Rango de división esperado según el rating del agente libre (HTML 4189-4193). */
  expectedRank: [
    { minRating: 68, rank: 3 },
    { minRating: 52, rank: 2 },
    { minRating: 0, rank: 1 },
  ],
  /** Nivel de cada división (HTML 882: DIV_RANK). */
  divRank: { A: 3, B: 2, C: 1 },
  /** Probabilidad de aceptar según la diferencia de nivel (HTML 4194-4199): sube 0 / 1 / 2 o más. */
  acceptChance: { same: 0.92, oneLevel: 0.35, moreLevels: 0.08 },
  /** "Difícil de convencer" si la probabilidad es menor (HTML 4249). */
  hardSellBelow: 0.5,
  /** Contrato al fichar o vender: rnd(2,4) años (HTML 4151, 4219, 4339). */
  contractYears: [2, 4],
  /** Ofertas por jugadores transferibles (HTML 4116-4137). */
  offers: {
    max: 4,
    chancePerDay: 0.4,
    /** Multiplicador del valor: contrato de 1 año o menos 0,60-0,85; si no, 0,85-1,20 (en centésimas). */
    shortContract: [60, 85],
    longContract: [85, 120],
  },
  /** Ojeadores (HTML 3992 solo los usa la cantera: sin regla para el mercado). Con 1 o más se ve el potencial real. */
  scoutsToReveal: 1,
  /** Sin ojeador, el potencial se muestra como un rango: [piso, techo] de margen (determinista por jugador). */
  potentialSpread: { below: [2, 6], above: [2, 8] },
  /** Una noticia de fichaje de la computadora se publica si el jugador tiene al menos este rating. */
  newsMinRating: 70,
  /** Máx. entradas de la cartera. */
  watchlistMax: 30,
  /** Mercado de la computadora (HTML 805-832) + freno a la acumulación de presupuesto. */
  ai: {
    /** HTML 807: compra con 35% si el plantel tiene menos de 20. */
    buyChance: 0.35,
    /** HTML 810: 50% elige un agente libre; si no, genera uno. */
    fromPoolChance: 0.5,
    /** NO está en el original (donde la computadora vacía la lista): tope de agentes libres que se lleva por evento. */
    poolPicksPerEvent: 3,
    /** HTML 813: 12% de estrella 68-82; si no 45-64. */
    starChance: 0.12,
    star: [68, 82],
    regular: [45, 64],
    /** HTML 823-831: vende al más flojo con 25% si tiene más de 8, y cobra 70% del valor. */
    sellChance: 0.25,
    sellMinSquad: 8,
    sellShare: 0.7,
    /** NO está en el original: los que tienen más plata que `reserve` invierten el excedente en fichajes. */
    reserve: 20000,
    /** Fracción del excedente que se gasta en cada evento de mercado. */
    surplusShare: 0.9,
    /** Máx. fichajes por evento por exceso de plata (calibrado en market.test.ts: mediana de presupuestos). */
    maxSurplusBuys: 8,
    /** Calidad de lo que compran con excedente: nivel de su división (TIER_LEVEL) + este plus. */
    surplusTierBonus: 3,
    /** Pagan como cualquier club comprador: valor × clubPriceMult (comisiones incluidas). */
    surplusPriceMult: 1.15,
    /** Con el plantel lleno, el fichaje por excedente reemplaza al más flojo (que se libera sin cobrar) si lo mejora en al menos esto. */
    swapMinGain: 0,
  },
} as const;

/** Clásicos (HTML 497-512): rival = el que más veces enfrentó el usuario y más parejo, con al menos 3 partidos. */
export const RIVALRY = {
  minMatches: 3,
  balanceWeight: 3,
} as const;
