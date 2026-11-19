// Avance de temporada: jugar fechas, actualizar estado de jugadores, ascensos/descensos y progresión.
// Las funciones MUTAN el estado recibido (se llaman dentro de immer `produce`).
import type { DivisionId, GameState, MatchEvent, MatchResult, Player, Team } from '../domain/types';
import { DISCIPLINE, FORM, MARKET, RETIREMENT, SQUAD } from './config';
import {
  computeAttendance, defaultTicketPrice, ensureSponsorOffers, generateSponsorOffers, medicalLevels, medicRecoveryMult, pickBestOffer,
  processClubFinances, signSponsor,
} from './finance';
import { generatePlayer, playerValue } from './generate';
import { tickMarket } from './market';
import { simulateMatch, type SimulatedMatch } from './match';
import { createRng, type Rng } from './rng';
import { isRivalMatch, recordH2H } from './rivalry';
import { doubleRoundRobin } from './schedule';
import { bestAvailableFive, canAddPlayer } from './squad';
import { applyResult, emptyRecord, standings } from './standings';
import { PRESS_META } from './strength';
import { allTeams, DIVISIONS, findTeam, pushNews, userTeam } from './world';

// Estas consultas viven en world.ts (para evitar ciclos); se reexportan porque el resto de la app las importa de acá.
export { allTeams, findTeam, pushNews, userTeam };

const PROMOTION_SLOTS = 2;

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
  // HTML 781: cada fisioterapeuta acelera 15% la recuperación de los que no juegan.
  const medicRecovery = medicRecoveryMult(team);
  const starters = new Set(team.lineup.filter((id): id is string => !!id));
  for (const p of team.squad) {
    p.fatigue = starters.has(p.id)
      ? clamp(Math.round(p.fatigue + 10 * mult), 0, 100)
      : clamp(Math.round(p.fatigue - 15 * medicRecovery), 0, 100);
  }
}

/**
 * Tarjetas, lesiones y cumplimiento de sanciones de UN equipo tras un partido (HTML 687-762).
 * Los que ya estaban suspendidos/lesionados ANTES del partido cumplen una fecha; los que se ganaron
 * la sanción en este partido empiezan a cumplirla en el siguiente.
 */
function applyDisciplineAndInjuries(
  state: GameState,
  team: Team,
  side: 'home' | 'away',
  events: MatchEvent[],
  isUser: boolean,
): void {
  const byId = new Map(team.squad.map((p) => [p.id, p]));
  const serving = team.squad.filter((p) => p.suspension > 0);
  const recovering = team.squad.filter((p) => p.injury);

  for (const e of events) {
    if (e.side !== side || !e.playerId) continue;
    const p = byId.get(e.playerId);
    if (!p) continue;
    if (e.type === 'foul' && e.card === 'red') {
      // HTML 733: Math.max(suspended, 1)
      p.stats.redCards++;
      p.suspension = Math.max(p.suspension, DISCIPLINE.redSuspension);
      if (isUser) pushNews(state, `🟥 ${p.name} fue expulsado: se pierde el próximo partido.`);
    } else if (e.type === 'foul' && e.card === 'yellow') {
      p.stats.yellowCards++;
      p.yellowAccum++;
      if (p.yellowAccum >= DISCIPLINE.yellowLimit) {
        // HTML 740: a las 4 amarillas, un partido de suspensión y se reinicia el conteo.
        p.suspension += 1;
        p.yellowAccum = 0;
        if (isUser) pushNews(state, `⛔ ${p.name} llegó a ${DISCIPLINE.yellowLimit} amarillas: se pierde el próximo partido.`);
      }
    } else if (e.type === 'injury' && e.injury && !p.injury) {
      p.injury = { ...e.injury };
      if (isUser) {
        const n = e.injury.matchesLeft;
        pushNews(state, `🚑 ${p.name} se lesionó (${e.injury.type}): vuelve en ${n} fecha${n === 1 ? '' : 's'}.`);
      }
    }
  }

  for (const p of serving) {
    p.suspension = Math.max(0, p.suspension - 1);
    if (p.suspension === 0 && isUser) pushNews(state, `✅ ${p.name} cumplió la sanción y vuelve a estar disponible.`);
  }
  for (const p of recovering) {
    if (!p.injury) continue;
    p.injury.matchesLeft--;
    if (p.injury.matchesLeft <= 0) {
      p.injury = null;
      p.fatigue = 0; // HTML 757
      if (isUser) pushNews(state, `✅ ${p.name} se recuperó y ya está disponible.`);
    }
  }
}

/** Forma tras el partido: titulares +1 si ganó, -1 si perdió, +1 extra si hizo gol; suplentes tienden a 0. */
function updateForm(team: Team, outcome: 'win' | 'draw' | 'loss', scorers: Set<string>): void {
  const starters = new Set(team.lineup.filter((id): id is string => !!id));
  for (const p of team.squad) {
    if (starters.has(p.id)) {
      const d = (outcome === 'win' ? 1 : outcome === 'loss' ? -1 : 0) + (scorers.has(p.id) ? 1 : 0);
      p.form = clamp(p.form + d, FORM.min, FORM.max);
    } else if (p.form !== 0) {
      p.form += p.form > 0 ? -1 : 1;
    }
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
  state.preseasonWeeksLeft = 0; // jugar una fecha implica que la pretemporada terminó
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
      // La computadora arma su alineación con los disponibles antes de cada partido.
      for (const t of [home, away]) if (t.id !== state.userTeamId) t.lineup = bestAvailableFive(t);
      const sim =
        isUser && userSim && userSim.result.homeId === hid && userSim.result.awayId === aid
          ? userSim
          : simulateMatch(home, away, rng, { medicalLevel: medicalLevels(home, away) });
      const r = sim.result;

      applyResult(home, away, r);
      recordPlayerStats(home, r, sim.events);
      recordPlayerStats(away, r, sim.events);
      updateMorale(home, r.hg > r.ag ? 'win' : r.hg < r.ag ? 'loss' : 'draw', rng);
      updateMorale(away, r.ag > r.hg ? 'win' : r.ag < r.hg ? 'loss' : 'draw', rng);
      const scorerIds = (teamId: string) =>
        new Set(r.scorers.filter((x) => x.teamId === teamId && x.playerId).map((x) => x.playerId as string));
      updateForm(home, r.hg > r.ag ? 'win' : r.hg < r.ag ? 'loss' : 'draw', scorerIds(home.id));
      updateForm(away, r.ag > r.hg ? 'win' : r.ag < r.hg ? 'loss' : 'draw', scorerIds(away.id));
      applyDisciplineAndInjuries(state, home, 'home', sim.events, home.id === state.userTeamId);
      applyDisciplineAndInjuries(state, away, 'away', sim.events, away.id === state.userTeamId);
      updateFatigue(home);
      updateFatigue(away);
      // Plata de la fecha (HTML 563-592, ahora para todos): la asistencia sale del estadio del local.
      // Clásico del usuario (HTML 1176): se evalúa con el historial previo a este partido.
      const attendance = computeAttendance(home, d, rng, isRivalMatch(state, hid, aid));
      for (const t of [home, away]) {
        const mine = t.id === state.userTeamId;
        processClubFinances(
          t,
          { season: state.season, matchday: div.matchday, isHome: t === home, attendance },
          mine,
          mine ? (text) => pushNews(state, text) : undefined,
        );
      }
      recordH2H(state, hid, aid, r.hg, r.ag);
      played.push(r);

      if (isUser) pushNews(state, userOutcomeText(state, home, away, r, div.matchday));
    }
    div.results.push(played);
    div.matchday++;
    all.push(...played);
  }

  state.rngState = rng.state();
  tickMarket(state); // ventanas de pases: mercado de la computadora, ofertas y listas (HTML 839-846)
  return all;
}

export function isSeasonOver(state: GameState): boolean {
  return DIVISIONS.every((d) => state.divisions[d].matchday >= state.divisions[d].schedule.length);
}

// ---------------------------------------------------------------------------------------------
// Nueva temporada
// ---------------------------------------------------------------------------------------------

/**
 * Retiro (HTML 2027-2031): forzado a los 40; desde los 32, probabilidad (edad - 31) * 10%.
 * Se evalúa con la edad ya cumplida en la nueva temporada.
 */
function retires(age: number, rng: Rng): boolean {
  if (age >= RETIREMENT.forcedAge) return true;
  if (age < RETIREMENT.fromAge) return false;
  return rng.chance(Math.min(1, (age - (RETIREMENT.fromAge - 1)) * RETIREMENT.perYear));
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
  p.yellowAccum = 0;
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

function rollTeamOver(state: GameState, team: Team, isUser: boolean, rng: Rng): void {
  const retiredPos: Player['pos'][] = [];
  for (const p of team.squad) {
    progressPlayer(p, rng);
    p.contractYears = Math.max(0, p.contractYears - 1);
  }
  team.squad = team.squad.filter((p) => {
    if (retires(p.age, rng)) {
      retiredPos.push(p.pos);
      if (isUser) pushNews(state, `👋 ${p.name} se retiró del fútbol.`);
      return false;
    }
    if (p.contractYears === 0) {
      // La computadora renueva sola; al usuario se le van libres los que no renovó.
      if (!isUser) {
        p.contractYears = rng.int(2, 4);
      } else {
        pushNews(state, `📄 ${p.name} se fue libre al vencer su contrato.`);
        return false;
      }
    }
    return true;
  });
  const before = team.squad.length;
  for (const pos of retiredPos) if (canAddPlayer(team)) team.squad.push(youngster(team, pos, rng));
  if (!team.squad.some((p) => p.pos === 'POR')) team.squad.push(youngster(team, 'POR', rng));
  while (team.squad.length < SQUAD.minSeason) {
    team.squad.push(youngster(team, rng.pick(['CIE', 'ALA', 'PIV'] as const), rng));
  }
  if (isUser && team.squad.length > before) {
    pushNews(state, `Las juveniles aportaron ${team.squad.length - before} jugador(es) al plantel.`);
  }
  const ids = new Set(team.squad.map((p) => p.id));
  team.penaltyTakers = team.penaltyTakers.filter((id) => ids.has(id));
  team.record = emptyRecord();
  team.lineup = bestAvailableFive(team);
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
    for (const t of div.teams) {
      rollTeamOver(state, t, t.id === userId, rng);
      // La computadora ajusta la entrada a su nueva división (si no, un equipo que asciende
      // cobraría precio de C contra la base de A). El usuario conserva el precio que eligió.
      if (t.id !== userId) t.finance.ticketPrice = defaultTicketPrice(d);
    }
    div.schedule = doubleRoundRobin(div.teams.map((t) => t.id));
    div.matchday = 0;
    div.results = [];
    if (userId && div.teams.some((t) => t.id === userId)) state.userDivision = d;
  }

  state.season++;
  state.preseasonWeeksLeft = MARKET.preseasonWeeks; // HTML 2066
  // Sponsors de la nueva temporada: la computadora elige sola (la que más plata deja); el usuario elige en Club.
  for (const d of DIVISIONS) {
    for (const t of state.divisions[d].teams) {
      if (t.id === userId) continue;
      signSponsor(t, pickBestOffer(generateSponsorOffers(t, rng), state.divisions[d].schedule.length), state.season);
    }
  }
  ensureSponsorOffers(state, rng);
  if (state.sponsorOffers?.season === state.season) pushNews(state, '🤝 Hay ofertas de auspiciantes para esta temporada: elegí una en Club.');
  if (userId && oldDivision && state.userDivision !== oldDivision) {
    const up = DIVISIONS.indexOf(state.userDivision!) < DIVISIONS.indexOf(oldDivision);
    pushNews(
      state,
      up
        ? `¡Ascenso! Arrancás la temporada ${state.season} en la División ${state.userDivision}.`
        : `Descenso. Arrancás la temporada ${state.season} en la División ${state.userDivision}.`,
    );
  }
  state.rngState = rng.state();
  tickMarket(state);
}
