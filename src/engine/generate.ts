// Generación de jugadores, plantillas, equipos y partida nueva. Port de genPlayer / genSquad / genOneTeam del HTML.
import { CITY_NAMES, CLUB_WORDS, FIRST_NAMES, LAST_NAMES, ORIGINS, TEAM_COLORS, TRAITS } from '../data/names';
import type { DivisionId, DtProfile, Foot, GameState, Player, Position, Team } from '../domain/types';
import { CURRENT_SAVE_VERSION } from '../repo/saveSchema';
import { buildCalendar } from './calendar';
import { COMPETITIONS, ECONOMY, LEAGUE, MARKET, YOUTH } from './config';
import { createFinance, defaultStaff } from './finance';
import { createRng, type Rng } from './rng';
import { doubleRoundRobin } from './schedule';
import { emptyRecord } from './standings';
import { emptyMarket } from './world';

export const TIER_LEVEL: Record<DivisionId, [number, number]> = { A: [60, 80], B: [46, 64], C: [34, 52] };

export function playerValue(rating: number): number {
  const base = Math.pow(Math.max(rating - 28, 1), 2.5) * 2.6;
  return Math.max(300, Math.round(base / 100) * 100);
}

export function pickFoot(rng: Rng): Foot {
  const r = rng.next();
  if (r < 0.7) return 'D';
  if (r < 0.93) return 'I';
  return 'A';
}

export function peakStartFromScore(score: number): number {
  return Math.round(30 - score * 6);
}

export function generatePlayerName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

export function generatePlayer(rng: Rng, pos: Position, baseLevel: number): Player {
  const r1 = baseLevel + rng.int(-8, 8), r2 = baseLevel + rng.int(-8, 8);
  const rating = Math.max(38, Math.min(86, Math.round((r1 + r2) / 2)));
  let potBonus = rng.int(1, 7);
  if (rng.chance(0.1)) potBonus += rng.int(6, 13);
  const potential = Math.max(rating, Math.min(89, rating + potBonus));
  const devScore = rng.next() * 0.5;
  const injuryProneness = Math.max(0.5, Math.min(1.8, 0.5 + rng.next() * 1.3));
  return {
    id: rng.id(),
    name: generatePlayerName(rng),
    pos,
    rating,
    potential,
    age: rng.int(18, 33),
    form: rng.int(-3, 3),
    fatigue: 0,
    value: playerValue(rating),
    contractYears: rng.int(1, 4),
    foot: pickFoot(rng),
    number: rng.int(1, 99),
    origin: rng.pick(ORIGINS),
    trait: rng.pick(TRAITS[pos]),
    injuryProneness,
    peakStart: peakStartFromScore(devScore),
    peakEnd: 30,
    stats: { goals: 0, assists: 0, gamesPlayed: 0, yellowCards: 0, redCards: 0 },
    injury: null,
    suspension: 0,
    yellowAccum: 0,
  };
}

const POSITIONS: Position[] = ['POR', 'CIE', 'ALA', 'PIV'];

/** Juvenil de la cantera (HTML 415-430). El valor es el del rating actual; la venta cobra el 50% (YOUTH.sellShare). */
export function generateAcademyPlayer(rng: Rng, scoutBonus: number, age: number, facility: number, division: DivisionId): Player {
  const pos = rng.pick(POSITIONS);
  const rating = Math.min(YOUTH.ratingCap, rng.int(YOUTH.rating[0], YOUTH.rating[1]) + scoutBonus * YOUTH.scoutBonus);
  const potential = Math.min(
    YOUTH.divCap[division],
    rating + rng.int(YOUTH.potentialGain[0], YOUTH.potentialGain[1]) + scoutBonus * YOUTH.scoutBonus + facility * YOUTH.facilityPotential + YOUTH.divBonus[division],
  );
  return {
    id: rng.id(),
    name: generatePlayerName(rng),
    pos,
    rating,
    potential,
    age,
    form: 0,
    fatigue: 0,
    value: playerValue(rating),
    contractYears: rng.int(YOUTH.contractYears[0], YOUTH.contractYears[1]),
    foot: pickFoot(rng),
    number: rng.int(1, 99),
    origin: rng.pick(ORIGINS),
    trait: rng.pick(TRAITS[pos]),
    injuryProneness: Math.max(0.5, Math.min(1.8, 0.5 + rng.next() * 1.3)),
    peakStart: null,
    peakEnd: 30,
    stats: { goals: 0, assists: 0, gamesPlayed: 0, yellowCards: 0, redCards: 0 },
    injury: null,
    suspension: 0,
    yellowAccum: 0,
  };
}

/** Cantera inicial: 3 juveniles por edad de 15 a 18 (HTML 431-435). */
export function generateAcademy(rng: Rng, scoutBonus: number, division: DivisionId): Player[] {
  const out: Player[] = [];
  for (const age of YOUTH.startAges) for (let i = 0; i < YOUTH.perAge; i++) out.push(generateAcademyPlayer(rng, scoutBonus, age, 0, division));
  return out;
}

/**
 * Cantera de un equipo recién creado (o de una partida migrada), derivada del id del equipo: no consume el rng de la
 * partida (así no cambia nada de lo ya generado) y es determinista.
 */
export function initialAcademy(teamId: string, division: DivisionId): Player[] {
  let h = 2166136261;
  for (let i = 0; i < teamId.length; i++) h = Math.imul(h ^ teamId.charCodeAt(i), 16777619);
  return generateAcademy(createRng((h ^ 0x9e3779b9) >>> 0), 0, division);
}

/** Campos de instalaciones y entrenamiento de un equipo nuevo. */
export function defaultYouthFields(academy: Player[]): Pick<Team, 'academy' | 'academyFacility' | 'trainingFacility' | 'training' | 'trainingIntensity'> {
  return { academy, academyFacility: 0, trainingFacility: 0, training: [], trainingIntensity: {} };
}

/** Perfil del DT al empezar (HTML 1272-1277); el origen sale de la semilla, sin tocar el rng de la partida. */
export function newDtProfile(seed: number): DtProfile {
  const rng = createRng((seed ^ 0x51ed270b) >>> 0);
  return {
    age: 45,
    origin: rng.pick(ORIGINS),
    career: { matches: 0, wins: 0, draws: 0, losses: 0, seasons: 0 },
    tenures: [],
    jobOffers: [],
    unemployed: false,
    fired: null,
    offersKey: null,
  };
}

function generateSquad(rng: Rng, baseLevel: number): Player[] {
  const squad: Player[] = [generatePlayer(rng, 'POR', baseLevel), generatePlayer(rng, 'POR', baseLevel - 6)];
  for (const pos of ['CIE', 'ALA', 'PIV'] as const) {
    for (let i = 0; i < 3; i++) squad.push(generatePlayer(rng, pos, baseLevel));
  }
  return squad;
}

/** Hace únicos los números de camiseta dentro del plantel (muta). */
export function dedupeNumbers(rng: Rng, squad: Player[]): void {
  const taken = new Set<number>();
  for (const p of squad) {
    while (taken.has(p.number)) p.number = rng.int(1, 99);
    taken.add(p.number);
  }
}

/** [arquero, 4 mejores de campo]. */
export function bestStartingFive(squad: Player[]): (string | null)[] {
  const gk = squad.filter((p) => p.pos === 'POR').sort((a, b) => b.rating - a.rating)[0];
  const rest = squad.filter((p) => p.pos !== 'POR').sort((a, b) => b.rating - a.rating).slice(0, 4);
  return [gk?.id ?? null, ...Array.from({ length: 4 }, (_, i) => rest[i]?.id ?? null)];
}

export function generateTeam(rng: Rng, usedNames: Set<string>, tier: DivisionId, colorIdx: number): Team {
  const range = TIER_LEVEL[tier];
  let name: string;
  do {
    name = `${rng.pick(CLUB_WORDS)} ${rng.pick(CITY_NAMES)}`;
  } while (usedNames.has(name));
  usedNames.add(name);
  const baseLevel = rng.int(range[0], range[1]);
  const squad = generateSquad(rng, baseLevel);
  dedupeNumbers(rng, squad);
  const id = rng.id();
  return {
    id,
    name,
    color: TEAM_COLORS[colorIdx % TEAM_COLORS.length],
    squad,
    lineup: bestStartingFive(squad),
    tactic: { formation: '2-2', press: 'media', style: 'equilibrado' },
    morale: 50,
    budget: rng.int(40, 90) * 1000,
    stadium: { name: `Estadio ${name}`, capacity: rng.int(400, 1500) },
    record: emptyRecord(),
    penaltyTakers: [],
    // HTML 483-485: sponsor de origen rnd(400,1800), 1 preparador, entrada según la división.
    finance: createFinance(tier, rng.int(ECONOMY.startSponsor.min, ECONOMY.startSponsor.max)),
    staff: defaultStaff(),
    ...defaultYouthFields(initialAcademy(id, tier)),
  };
}

/**
 * Invitado de la Copa Internacional (HTML 957-966): nivel rnd(58,78), estadio de 600-2000 lugares, entrada a 10.
 * No pertenece a ninguna división; vive en `state.intlGuestTeams`.
 */
export function generateGuestTeam(rng: Rng, name: string, colorIdx: number): Team {
  const { guestLevel, guestCapacity, guestTicketPrice } = COMPETITIONS.intl;
  const squad = generateSquad(rng, rng.int(guestLevel[0], guestLevel[1]));
  dedupeNumbers(rng, squad);
  const finance = createFinance('C', rng.int(ECONOMY.startSponsor.min, ECONOMY.startSponsor.max));
  finance.ticketPrice = guestTicketPrice;
  return {
    id: rng.id(),
    name,
    color: TEAM_COLORS[colorIdx % TEAM_COLORS.length],
    squad,
    lineup: bestStartingFive(squad),
    tactic: { formation: '2-2', press: 'media', style: 'equilibrado' },
    morale: 50,
    budget: rng.int(40, 90) * 1000,
    stadium: { name: `Estadio ${name}`, capacity: rng.int(guestCapacity[0], guestCapacity[1]) },
    record: emptyRecord(),
    penaltyTakers: [],
    finance,
    staff: defaultStaff(),
    ...defaultYouthFields([]), // HTML 964: los invitados no tienen cantera
  };
}

export function createNewGame(seed: number, dtName: string): GameState {
  const rng = createRng(seed);
  const usedNames = new Set<string>();
  const build = (id: DivisionId) => {
    const teams = Array.from({ length: LEAGUE.teamsPerDivision }, (_, i) => generateTeam(rng, usedNames, id, i));
    return {
      id, teams, schedule: doubleRoundRobin(teams.map((t) => t.id)), matchday: 0, results: [],
      phase: 'regular' as const, playoff: null, promotedDirect: null, relegated: null,
    };
  };
  const divisions = { A: build('A'), B: build('B'), C: build('C') };
  return {
    version: CURRENT_SAVE_VERSION,
    seed,
    rngState: rng.state(),
    season: 1,
    dtName,
    dt: newDtProfile(seed),
    userTeamId: null,
    userDivision: null,
    divisions,
    news: [],
    sponsorOffers: null,
    preseasonWeeksLeft: MARKET.preseasonWeeks, // HTML 1264: la primera temporada también arranca con pretemporada
    market: emptyMarket(),
    watchlist: [],
    h2h: {},
    // La copa se sortea en `ensureCompetitions` (competitions.ts), que necesita el motor completo.
    calendar: buildCalendar({ leagueRounds: divisions.A.schedule.length, cup: true, intl: false }),
    calendarIndex: 0,
    cup: null,
    intlCup: null,
    intlGuestTeams: {},
    intlCupQualifiedNextSeason: null,
    championsCup: null,
    championsHistory: [],
    lastSeasonAStandings: null,
    objective: null,
    seasonHistory: [],
    titles: [],
  };
}
