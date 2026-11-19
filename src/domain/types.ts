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
