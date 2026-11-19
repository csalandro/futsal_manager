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
  /** Goles (ya sumados en `goals`) hechos en copas y playoffs; los de liga = goals - cupGoals. Ausente = 0. */
  cupGoals?: number;
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
  | 'empleados'
  | 'instalaciones';

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
  /** Cantera: juveniles de 15 a 18 años (HTML 413-471, 3094-3178). Todos los equipos tienen. */
  academy: Player[];
  /** Nivel del centro juvenil, 0-5 (HTML 485, 3105). */
  academyFacility: number;
  /** Nivel del centro de entrenamiento, 0-5 (HTML 625-636). */
  trainingFacility: number;
  /** Ids de los jugadores en entrenamiento individual (solo el usuario entrena; HTML 637-641). */
  training: string[];
  /** Intensidad elegida por jugador; ausente = 'normal' (HTML 614-616). */
  trainingIntensity: Record<string, TrainingIntensity>;
}

export type TrainingIntensity = 'suave' | 'normal' | 'intensa';

/** Partido programado: ids de local y visitante. */
export type Fixture = [homeId: string, awayId: string];

export interface MatchResult {
  homeId: string;
  awayId: string;
  hg: number;
  ag: number;
  /** Solo en eliminatorias: ganador por penales (con `kicks` si viene de una tanda simulada). */
  penalties?: { home: number; away: number; kicks?: PenaltyKick[] };
  scorers: { teamId: string; playerId: string | null; minute: number }[];
}

/** Un penal de la tanda. */
export interface PenaltyKick {
  side: 'home' | 'away';
  taker: string;
  scored: boolean;
}

export interface Division {
  id: DivisionId;
  teams: Team[];
  /** rondas → partidos */
  schedule: Fixture[][];
  matchday: number; // índice de la próxima fecha a jugar
  results: MatchResult[][]; // resultados por fecha jugada
  /** 'regular' = liga en curso; 'playoffs' = fase final; 'done' = todo definido (HTML 1249-1251). */
  phase: 'regular' | 'playoffs' | 'done';
  playoff: Playoff | null;
  /** B y C: campeón de la liga, asciende directo (HTML 1705). */
  promotedDirect: string | null;
  /** Descienden al terminar la temporada (HTML 1713-1723). En C salen igual y entran equipos nuevos. */
  relegated: string[] | null;
}

// ---------------------------------------------------------------------------------------------
// Competiciones (HTML 849-1083, 1659-1850)
// ---------------------------------------------------------------------------------------------

/** Resultado resumido de un cruce a partido único; si hay empate, `penalties` define. */
export interface TieResult {
  hg: number;
  ag: number;
  penalties?: { home: number; away: number };
}

/** Cruce o partido de una copa: ids de local y visitante y su resultado (null = pendiente). */
export interface Tie {
  home: string;
  away: string;
  result: TieResult | null;
  label?: string;
}

export interface Cup {
  /** Índice de la ronda en curso (0 = primera ronda ... 5 = final). */
  stage: number;
  ties: Tie[];
  /** Con bye: entran en la segunda ronda (HTML 920, 1162). */
  pendingByes: string[] | null;
  rounds: { stage: number; ties: Tie[] }[];
  champion: string | null;
}

export type PlayoffStage = 'QF' | 'SF' | 'F';

export interface Playoff {
  quals: string[];
  stage: PlayoffStage | 'done';
  ties: Tie[];
  rounds: { stage: PlayoffStage; ties: Tie[] }[];
  /** A: campeón (HTML 1680); B y C: segundo ascenso. */
  winner: string | null;
}

export type IntlGroupId = 'A' | 'B' | 'C';

export interface IntlGroupRow {
  id: string;
  pts: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
}

export interface IntlCup {
  stage: 'groups' | 'QF' | 'SF' | 'F' | 'done';
  /** Fecha de grupos en curso (0-2); al llegar a 3 se arman los cuartos. */
  groupRound: number;
  groups: Record<IntlGroupId, IntlGroupRow[]>;
  /** grupo → fechas → partidos. */
  groupSchedule: Record<IntlGroupId, Tie[][]>;
  ties: Tie[];
  rounds: { stage: 'QF' | 'SF' | 'F'; ties: Tie[] }[];
  champion: string | null;
}

export interface ChampionsCup {
  stage: 'SF' | 'F' | 'done';
  ties: Tie[];
  rounds: { stage: 'SF' | 'F'; ties: Tie[] }[];
  champion: string | null;
  /** Quién representa a la copa nacional (el subcampeón de A si el campeón de copa ya estaba clasificado; HTML 1755-1763). */
  copaRepresentative: string | null;
}

/** Paso del calendario: una fecha de liga o una ronda de una competición (HTML 852-870). */
export type CalendarStep =
  | { kind: 'league'; round: number }
  | { kind: 'cup'; round: number }
  /** 0-2 = fechas de grupos; 3 = cuartos; 4 = semifinal; 5 = final. */
  | { kind: 'intl'; round: number }
  | { kind: 'playoff'; stage: PlayoffStage }
  | { kind: 'champions'; stage: 'SF' | 'F' };

export type CompetitionKey = 'divA' | 'divB' | 'divC' | 'copa' | 'intl' | 'campeones';

export interface TeamRef {
  id: string;
  name: string;
}

/** Campeones de una temporada (HTML 1841-1849). */
export interface ChampionsHistoryEntry {
  season: number;
  champA: TeamRef | null;
  champB: TeamRef | null;
  champC: TeamRef | null;
  champCup: TeamRef | null;
  champCupRep: TeamRef | null;
  champChampionsCup: TeamRef | null;
  champIntl: TeamRef | null;
}

export type ObjectiveType = 'title' | 'playoffs' | 'promote' | 'playoff_promote' | 'survive' | 'top_half';

/** Objetivo de temporada del usuario (HTML 1544-1570). */
export interface SeasonObjective {
  division: DivisionId;
  season: number;
  tier: 'top' | 'mid' | 'bottom';
  type: ObjectiveType;
  text: string;
}

/** Cierre de temporada del usuario (HTML 1953-1956); `objectiveMet` alimenta la presión de la directiva (HTML 1957-1962). */
export interface SeasonRecord {
  /** Club dirigido esa temporada. Ausente en partidas anteriores a la v6 (= el club vigente). */
  teamId?: string;
  teamName?: string;
  season: number;
  division: DivisionId;
  position: number;
  outcome: string;
  objective: SeasonObjective | null;
  objectiveMet: boolean | null;
}

/** Título del usuario (para el palmarés). */
export interface Title {
  season: number;
  competition: CompetitionKey;
  /** Club con el que se ganó. Ausente en partidas anteriores a la v6. */
  teamId?: string;
  teamName?: string;
}

/** Récord de carrera del DT (HTML 1277, 1354-1358): todos los partidos, de cualquier competición. Los títulos salen de `titles`. */
export interface DtCareer {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  /** Temporadas completas dirigidas (HTML 2067-2068). */
  seasons: number;
}

/** Paso por un club (historial por club dirigido). `toSeason` null = es el club actual. */
export interface ClubTenure {
  teamId: string;
  teamName: string;
  fromSeason: number;
  toSeason: number | null;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  seasons: number;
}

/** Oferta de trabajo de otro club (HTML 1906-1942). */
export interface JobOffer {
  teamId: string;
  season: number;
}

/** Perfil del DT (HTML 1272-1277, 3712-3827). */
export interface DtProfile {
  age: number;
  origin: string;
  career: DtCareer;
  tenures: ClubTenure[];
  jobOffers: JobOffer[];
  /** Sin club: la directiva lo despidió y espera ofertas; `userTeamId` es null. */
  unemployed: boolean;
  /** Último despido. */
  fired: { club: string; clubId: string; season: number; division: DivisionId } | null;
  /** Marca de la fecha en que se tiraron las ofertas (idempotencia). */
  offersKey: string | null;
}

export interface GameState {
  version: number;
  seed: number;
  /** Estado interno del RNG; se persiste para que la partida sea reproducible. */
  rngState: number;
  season: number;
  dtName: string;
  dt: DtProfile;
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
  /** Calendario intercalado de la temporada y paso actual (HTML 852-871). Los pasos anteriores al índice ya están hechos. */
  calendar: CalendarStep[];
  calendarIndex: number;
  cup: Cup | null;
  /** Solo hay Copa Internacional si en la temporada anterior hubo un clasificado (HTML 2056-2061). */
  intlCup: IntlCup | null;
  /** Equipos invitados de la Internacional, por id (HTML 955); no pertenecen a ninguna división. */
  intlGuestTeams: Record<string, Team>;
  /** Id del clasificado a la Internacional de la temporada que viene: campeón de los playoffs de A (HTML 1949, 2056). */
  intlCupQualifiedNextSeason: string | null;
  championsCup: ChampionsCup | null;
  championsHistory: ChampionsHistoryEntry[];
  /** Posiciones finales de A de la temporada anterior: definen los byes de la copa (HTML 1963). */
  lastSeasonAStandings: string[] | null;
  objective: SeasonObjective | null;
  seasonHistory: SeasonRecord[];
  titles: Title[];
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
