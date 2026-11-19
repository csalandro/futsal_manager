// Modelo de dominio del juego. Todo es serializable a JSON (se guarda tal cual en Supabase como jsonb).

export type Position = 'POR' | 'CIE' | 'ALA' | 'PIV';
export type Foot = 'D' | 'I' | 'A';
export type DivisionId = 'A' | 'B' | 'C';
export type Formation = '2-2' | '4-0' | '1-2-1' | '2-1-1' | '1-1-2';
export type Press = 'baja' | 'media' | 'alta';
export type Style = 'equilibrado' | 'posesion' | 'contragolpe';

export interface Player {
  id: string;
  name: string;
  pos: Position;
  rating: number;
  potential: number;
  age: number;
  form: number; // -5..+5
  fatigue: number; // 0..100
  value: number;
  contractYears: number;
  foot: Foot;
  number: number;
  origin: string;
  trait: string;
  injuryProneness: number;
  peakStart: number | null;
  peakEnd: number;
  stats: PlayerStats;
  /** Lesión vigente (null = sano); matchesLeft = fechas que le faltan. */
  injury: { type: string; matchesLeft: number } | null;
  /** Partidos de sanción que le faltan cumplir. */
  suspension: number;
  /** Amarillas acumuladas hacia la próxima suspensión. */
  yellowAccum: number;
  /** El usuario lo puso en la lista de transferibles: puede recibir ofertas (HTML 3018-3023). Ausente = no. */
  transferListed?: boolean;
}

export interface PlayerStats {
  goals: number;
  assists: number;
  gamesPlayed: number;
  yellowCards: number;
  redCards: number;
}

export interface Tactic {
  formation: Formation;
  press: Press;
  style: Style;
}

export interface TeamRecord {
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

/** Concepto de un movimiento de plata (HTML 579-580: entradas, sponsor, sueldos, mantenimiento + gastos puntuales). */
export type FinanceConcept =
  | 'entradas'
  | 'sponsor'
  | 'bono'
  | 'sueldos'
  | 'staff'
  | 'mantenimiento'
  | 'contratos'
  | 'fichajes'
  | 'ventas'
  | 'estadio'
  | 'empleados';

export interface FinanceEntry {
  season: number;
  /** Índice de fecha (0 = primera) o null si fue un movimiento fuera de fecha. */
  matchday: number | null;
  concept: FinanceConcept;
  /** Con signo: positivo ingresa, negativo sale. */
  amount: number;
  label: string;
}

/** Auspiciante vigente: `perMatch` por fecha; `season` = temporada en que se firmó (0 = el de origen). */
export interface SponsorDeal {
  name: string;
  perMatch: number;
  season: number;
}

export interface SponsorOffer {
  name: string;
  perMatch: number;
  /** Bono único al firmar. */
  bonus: number;
}

export type StaffKey = 'trainers' | 'medics' | 'doctors' | 'scouts' | 'youthCoaches';
export type StaffCounts = Record<StaffKey, number>;

export interface TeamFinance {
  ticketPrice: number;
  sponsor: SponsorDeal;
  /** Últimos movimientos, el más nuevo al final. */
  log: FinanceEntry[];
  /** Acumulado por concepto de la temporada `season` (se reinicia solo al cambiar de temporada). */
  totals: { season: number; byConcept: Partial<Record<FinanceConcept, number>> };
  /** Fechas seguidas con presupuesto negativo (HTML 581-582). */
  debtStreak: number;
  /** La directiva restringió los gastos (HTML 583-586). */
  financialLockout: boolean;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  squad: Player[];
  /** 5 ids: [arquero, 4 de campo]; null = vacío */
  lineup: (string | null)[];
  tactic: Tactic;
  morale: number; // 0..100
  budget: number;
  stadium: { name: string; capacity: number };
  record: TeamRecord;
  /** Pateadores de penales, en orden (máx 5 ids). Vacío = patean los mejores. */
  penaltyTakers: string[];
  finance: TeamFinance;
  staff: StaffCounts;
}

/** Partido programado: ids de local y visitante. */
export type Fixture = [homeId: string, awayId: string];

export interface MatchResult {
  homeId: string;
  awayId: string;
  hg: number;
  ag: number;
  /** Solo en eliminatorias: ganador por penales. */
  penalties?: { home: number; away: number };
  scorers: { teamId: string; playerId: string | null; minute: number }[];
}

export interface Division {
  id: DivisionId;
  teams: Team[];
  /** rondas → partidos */
  schedule: Fixture[][];
  matchday: number; // índice de la próxima fecha a jugar
  results: MatchResult[][]; // resultados por fecha jugada
}

export interface GameState {
  version: number;
  seed: number;
  /** Estado interno del RNG; se persiste para que la partida sea reproducible. */
  rngState: number;
  season: number;
  dtName: string;
  userTeamId: string | null;
  userDivision: DivisionId | null;
  divisions: Record<DivisionId, Division>;
  news: string[];
  /** Ofertas de auspiciantes pendientes para el usuario (HTML 538-552). null = nada para elegir. */
  sponsorOffers: { season: number; offers: SponsorOffer[] } | null;
  /** Semanas de pretemporada que faltan (sin partidos, mercado abierto). HTML 1264, 2066, 2270. */
  preseasonWeeksLeft: number;
  market: MarketState;
  watchlist: WatchEntry[];
  /** Historial por par de equipos; clave = ids ordenados unidos con '|'. */
  h2h: Record<string, H2HRecord>;
}

/** Oferta de otro club por un jugador del usuario (HTML 4116-4137). */
export interface TransferOffer {
  playerId: string;
  /** Club que ofrece. */
  teamId: string;
  price: number;
}

/** Un jugador de otro club ofrecido en la lista de la ventana (HTML 4160-4172). */
export interface ClubListing {
  playerId: string;
  teamId: string;
}

export interface MarketState {
  /** Ventana para la que se generaron los agentes libres (p. ej. 'early-1'); null = ninguna todavía. */
  freeAgentsWindow: string | null;
  freeAgents: Player[];
  /** Jugadores de otros clubes ofrecidos; se renuevan en cada fecha con el mercado abierto. */
  clubListings: ClubListing[];
  /** Marca de la fecha en que se renovaron `clubListings` y las ofertas (idempotencia). */
  dayKey: string | null;
  /** Ofertas recibidas por jugadores transferibles del usuario. */
  offers: TransferOffer[];
  /** Eventos de mercado de la computadora ya procesados (p. ej. 'early-1:open'). */
  aiDone: string[];
  /** Jugadores que rechazaron al usuario en la ventana actual (no se puede insistir). */
  refused: string[];
}

/** Jugador seguido en la cartera: foto del momento en que se agregó y evolución por temporada. */
export interface WatchEntry {
  playerId: string;
  /** Último club conocido. */
  teamId: string;
  since: { season: number; rating: number; potential: number };
  history: { season: number; rating: number }[];
}

/** Historial entre dos equipos, desde la óptica del de id menor (`first`). */
export interface H2HRecord {
  first: string;
  second: string;
  firstWins: number;
  draws: number;
  secondWins: number;
  firstGoals: number;
  secondGoals: number;
}

export type MatchEventType = 'goal' | 'chance' | 'save' | 'foul' | 'build' | 'injury';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  side: 'home' | 'away';
  text: string;
  scorerId?: string | null;
  assistId?: string | null;
  card?: 'yellow' | 'red' | null;
  /** Jugador amonestado/expulsado (foul con tarjeta) o lesionado (injury). */
  playerId?: string | null;
  /** Solo en 'injury': la lesión que sufrió. */
  injury?: { type: string; matchesLeft: number };
}
