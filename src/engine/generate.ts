// Generación de jugadores, plantillas, equipos y partida nueva. Port de genPlayer / genSquad / genOneTeam del HTML.
import { CITY_NAMES, CLUB_WORDS, FIRST_NAMES, LAST_NAMES, ORIGINS, TEAM_COLORS, TRAITS } from '../data/names';
import type { DivisionId, Foot, GameState, Player, Position, Team } from '../domain/types';
import { CURRENT_SAVE_VERSION } from '../repo/saveSchema';
import { LEAGUE } from './config';
import { createRng, type Rng } from './rng';
import { doubleRoundRobin } from './schedule';
import { emptyRecord } from './standings';

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
  return {
    id: rng.id(),
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
  };
}

export function createNewGame(seed: number, dtName: string): GameState {
  const rng = createRng(seed);
  const usedNames = new Set<string>();
  const build = (id: DivisionId) => {
    const teams = Array.from({ length: LEAGUE.teamsPerDivision }, (_, i) => generateTeam(rng, usedNames, id, i));
    return { id, teams, schedule: doubleRoundRobin(teams.map((t) => t.id)), matchday: 0, results: [] };
  };
  const divisions = { A: build('A'), B: build('B'), C: build('C') };
  return {
    version: CURRENT_SAVE_VERSION,
    seed,
    rngState: rng.state(),
    season: 1,
    dtName,
    userTeamId: null,
    userDivision: null,
    divisions,
    news: [],
  };
}
