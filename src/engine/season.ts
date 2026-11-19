// Avance de temporada: jugar fechas, actualizar estado de jugadores, ascensos/descensos y progresión.
// Las funciones MUTAN el estado recibido (se llaman dentro de immer `produce`).
import type { DivisionId, GameState, MatchEvent, MatchResult, Player, Team } from '../domain/types';
import { bestStartingFive, generatePlayer, playerValue } from './generate';
import { simulateMatch, type SimulatedMatch } from './match';
import { createRng, type Rng } from './rng';
import { doubleRoundRobin } from './schedule';
import { applyResult, emptyRecord, standings } from './standings';
import { PRESS_META } from './strength';

const DIVISIONS: DivisionId[] = ['A', 'B', 'C'];
const PROMOTION_SLOTS = 2;
const MAX_NEWS = 30;
const MIN_SQUAD = 10;

export function allTeams(state: GameState): Team[] {
  return DIVISIONS.flatMap((d) => state.divisions[d].teams);
}

export function findTeam(state: GameState, id: string): Team | undefined {
  return allTeams(state).find((t) => t.id === id);
}

export function userTeam(state: GameState): Team | undefined {
  return state.userTeamId ? findTeam(state, state.userTeamId) : undefined;
}

export function userNextFixture(state: GameState): { home: Team; away: Team; matchday: number } | null {
  if (!state.userDivision || !state.userTeamId) return null;
  const div = state.divisions[state.userDivision];
  const round = div.schedule[div.matchday];
  if (!round) return null;
  const fx = round.find(([h, a]) => h === state.userTeamId || a === state.userTeamId);
  if (!fx) return null;
  const home = div.teams.find((t) => t.id === fx[0]);
  const away = div.teams.find((t) => t.id === fx[1]);
  return home && away ? { home, away, matchday: div.matchday } : null;
}

export function updateMorale(team: Team, outcome: 'win' | 'draw' | 'loss', rng: Rng): void {
  if (outcome === 'win') team.morale = Math.min(100, team.morale + rng.int(4, 8));
  else if (outcome === 'draw') team.morale = Math.max(0, Math.min(100, team.morale + rng.int(-1, 1)));
  else team.morale = Math.max(0, team.morale - rng.int(4, 8));
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function updateFatigue(team: Team): void {
  const mult = PRESS_META[team.tactic.press]?.fatigueMult ?? 1;
  const starters = new Set(team.lineup.filter((id): id is string => !!id));
  for (const p of team.squad) {
    p.fatigue = starters.has(p.id)
      ? clamp(Math.round(p.fatigue + 10 * mult), 0, 100)
      : clamp(p.fatigue - 15, 0, 100);
  }
}

function recordPlayerStats(team: Team, result: MatchResult, events: MatchEvent[]): void {
  const byId = new Map(team.squad.map((p) => [p.id, p]));
  for (const id of team.lineup) {
    const p = id ? byId.get(id) : undefined;
    if (p) p.stats.gamesPlayed++;
  }
  for (const s of result.scorers) {
    if (s.teamId === team.id && s.playerId) {
      const p = byId.get(s.playerId);
      if (p) p.stats.goals++;
    }
  }
  const side = team.id === result.homeId ? 'home' : 'away';
  for (const e of events) {
    if (e.type === 'goal' && e.side === side && e.assistId) {
      const p = byId.get(e.assistId);
      if (p) p.stats.assists++;
    }
  }
}

function userOutcomeText(state: GameState, home: Team, away: Team, r: MatchResult, matchday: number): string {
  const isHome = home.id === state.userTeamId;
  const mine = isHome ? r.hg : r.ag, theirs = isHome ? r.ag : r.hg;
  const rival = isHome ? away.name : home.name;
  const verb = mine > theirs ? 'Ganaste' : mine < theirs ? 'Perdiste' : 'Empataste';
  const prep = mine === theirs ? 'con' : 'ante';
  return `Fecha ${matchday + 1}: ${verb} ${mine}-${theirs} ${prep} ${rival}.`;
}

/** Juega la fecha actual de las 3 divisiones. */
export function playMatchday(state: GameState, userSim?: SimulatedMatch): MatchResult[] {
  const rng = createRng(state.rngState);
  const all: MatchResult[] = [];

  for (const d of DIVISIONS) {
    const div = state.divisions[d];
    const round = div.schedule[div.matchday];
    if (!round) continue;
    const byId = new Map(div.teams.map((t) => [t.id, t]));
    const played: MatchResult[] = [];

    for (const [hid, aid] of round) {
      const home = byId.get(hid)!, away = byId.get(aid)!;
      const isUser = state.userTeamId !== null && (hid === state.userTeamId || aid === state.userTeamId);
      const sim =
        isUser && userSim && userSim.result.homeId === hid && userSim.result.awayId === aid
          ? userSim
          : simulateMatch(home, away, rng);
      const r = sim.result;

      applyResult(home, away, r);
      recordPlayerStats(home, r, sim.events);
      recordPlayerStats(away, r, sim.events);
      updateMorale(home, r.hg > r.ag ? 'win' : r.hg < r.ag ? 'loss' : 'draw', rng);
      updateMorale(away, r.ag > r.hg ? 'win' : r.ag < r.hg ? 'loss' : 'draw', rng);
      updateFatigue(home);
      updateFatigue(away);
      played.push(r);

      if (isUser) {
        state.news.unshift(userOutcomeText(state, home, away, r, div.matchday));
        if (state.news.length > MAX_NEWS) state.news.length = MAX_NEWS;
      }
    }
    div.results.push(played);
    div.matchday++;
    all.push(...played);
  }

  state.rngState = rng.state();
  return all;
}

export function isSeasonOver(state: GameState): boolean {
  return DIVISIONS.every((d) => state.divisions[d].matchday >= state.divisions[d].schedule.length);
}

// ---------------------------------------------------------------------------------------------
// Nueva temporada
// ---------------------------------------------------------------------------------------------

/** Probabilidad de retiro: 30% a los 38 y +20 puntos por año. */
function retireChance(age: number): number {
  return age < 38 ? 0 : Math.min(1, 0.3 + 0.2 * (age - 38));
}

function progressPlayer(p: Player, rng: Rng): void {
  p.age++;
  const peakStart = p.peakStart ?? 26;
  if (p.age < peakStart) {
    if (p.rating < p.potential) p.rating = Math.min(p.potential, p.rating + rng.int(1, 4));
  } else if (p.age >= p.peakEnd) {
    p.rating = Math.max(30, p.rating - rng.int(1, 3));
  }
  p.value = playerValue(p.rating);
  p.form = 0;
  p.fatigue = 0;
  p.stats = { goals: 0, assists: 0, gamesPlayed: 0, yellowCards: 0, redCards: 0 };
}

function freeNumber(squad: Player[], rng: Rng): number {
  const taken = new Set(squad.map((p) => p.number));
  let n = rng.int(1, 99);
  while (taken.has(n)) n = rng.int(1, 99);
  return n;
}

function youngster(team: Team, pos: Player['pos'], rng: Rng): Player {
  const j = generatePlayer(rng, pos, 40);
  j.age = rng.int(18, 20);
  j.number = freeNumber(team.squad, rng);
  return j;
}

function rollTeamOver(team: Team, isUser: boolean, rng: Rng): void {
  const retiredPos: Player['pos'][] = [];
  team.squad = team.squad.filter((p) => {
    if (rng.chance(retireChance(p.age))) {
      retiredPos.push(p.pos);
      return false;
    }
    return true;
  });
  for (const p of team.squad) {
    progressPlayer(p, rng);
    p.contractYears = Math.max(0, p.contractYears - 1);
    // La computadora renueva sola; el usuario gestiona sus contratos.
    if (!isUser && p.contractYears === 0) p.contractYears = rng.int(2, 4);
  }
  for (const pos of retiredPos) team.squad.push(youngster(team, pos, rng));
  while (team.squad.length < MIN_SQUAD) {
    team.squad.push(youngster(team, rng.pick(['CIE', 'ALA', 'PIV'] as const), rng));
  }
  team.record = emptyRecord();
  team.lineup = bestStartingFive(team.squad);
}

export function startNewSeason(state: GameState): void {
  const rng = createRng(state.rngState);
  const order = Object.fromEntries(DIVISIONS.map((d) => [d, standings(state.divisions[d].teams)])) as Record<
    DivisionId,
    Team[]
  >;
  const n = PROMOTION_SLOTS;
  const keep = (d: DivisionId, from: number, to: number) => order[d].slice(from, to);
  const len = (d: DivisionId) => order[d].length;

  const next: Record<DivisionId, Team[]> = {
    A: [...keep('A', 0, len('A') - n), ...keep('B', 0, n)],
    B: [...keep('A', len('A') - n, len('A')), ...keep('B', n, len('B') - n), ...keep('C', 0, n)],
    C: [...keep('B', len('B') - n, len('B')), ...keep('C', n, len('C'))],
  };

  const userId = state.userTeamId;
  const oldDivision = state.userDivision;
  for (const d of DIVISIONS) {
    const div = state.divisions[d];
    div.teams = next[d];
    for (const t of div.teams) rollTeamOver(t, t.id === userId, rng);
    div.schedule = doubleRoundRobin(div.teams.map((t) => t.id));
    div.matchday = 0;
    div.results = [];
    if (userId && div.teams.some((t) => t.id === userId)) state.userDivision = d;
  }

  state.season++;
  if (userId && oldDivision && state.userDivision !== oldDivision) {
    const up = DIVISIONS.indexOf(state.userDivision!) < DIVISIONS.indexOf(oldDivision);
    state.news.unshift(
      up
        ? `¡Ascenso! Arrancás la temporada ${state.season} en la División ${state.userDivision}.`
        : `Descenso. Arrancás la temporada ${state.season} en la División ${state.userDivision}.`,
    );
    if (state.news.length > MAX_NEWS) state.news.length = MAX_NEWS;
  }
  state.rngState = rng.state();
}
