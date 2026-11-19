// Avance de temporada: pasos del calendario, ascensos/descensos y progresión.
// Las funciones MUTAN el estado recibido (se llaman dentro de immer `produce`).
import type { CalendarStep, DivisionId, GameState, MatchResult, Player, Team } from '../domain/types';
import { buildCalendar, stepLabel } from './calendar';
import { buildCup, buildIntlCup, ensureCompetitions, runStep, userStepFixture } from './competitions';
import { BOARD, COMPETITIONS, MARKET, RETIREMENT, SQUAD } from './config';
import { boardPressure, dismissUser, objectiveOutlook, recordCareerSeason, rollFreeAgentOffers, rollJobOffers, shouldFire } from './dt';
import { defaultTicketPrice, ensureSponsorOffers, generateSponsorOffers, pickBestOffer, signSponsor } from './finance';
import { generatePlayer, generateTeam, playerValue } from './generate';
import { advancePreseason, isPreseason, tickMarket } from './market';
import type { SimulatedMatch } from './match';
import { computeSeasonObjective, evaluateObjective } from './objective';
import { updateMorale } from './play';
import { createRng, type Rng } from './rng';
import { doubleRoundRobin } from './schedule';
import { bestAvailableFive } from './squad';
import { emptyRecord, standings } from './standings';
import { processTraining } from './training';
import { ageAcademy } from './youth';
import { allTeams, DIVISIONS, findTeam, pushNews, userTeam } from './world';

// Estas consultas viven en world.ts (para evitar ciclos); se reexportan porque el resto de la app las importa de acá.
export { allTeams, findTeam, pushNews, updateMorale, userTeam };

export function currentStep(state: GameState): CalendarStep | null {
  return state.calendar[state.calendarIndex] ?? null;
}

export interface UserFixture {
  home: Team;
  away: Team;
  /** Fecha de liga en curso (matchday de la división del usuario). */
  matchday: number;
  step: CalendarStep;
  knockout: boolean;
  /** "Fecha 7", "Copa · Octavos de final", ... */
  label: string;
}

/** Partido del usuario en el paso actual del calendario; null si en este paso no juega (o no hay más pasos). */
export function userNextFixture(state: GameState): UserFixture | null {
  if (!state.userDivision || !state.userTeamId) return null;
  const step = currentStep(state);
  if (!step) return null;
  const fx = userStepFixture(state, step);
  if (!fx) return null;
  const home = findTeam(state, fx.homeId), away = findTeam(state, fx.awayId);
  if (!home || !away) return null;
  return { home, away, matchday: state.divisions[state.userDivision].matchday, step, knockout: fx.knockout, label: fx.label };
}

/** Descripción del paso actual para la UI ("Copa · Octavos de final"), o null si terminó la temporada. */
export function currentStepLabel(state: GameState): string | null {
  const step = currentStep(state);
  return step ? stepLabel(step) : null;
}

/**
 * Juega el paso actual del calendario (liga, copa, internacional, playoffs o Copa de Campeones) y, a continuación,
 * simula solos los pasos que no son de liga y en los que el usuario no juega (como advanceCalendarIfNoUserAction,
 * HTML 1098-1156). Devuelve los resultados de liga jugados.
 */
export function playNextStep(state: GameState, userSim?: SimulatedMatch): MatchResult[] {
  ensureCompetitions(state);
  const rng = createRng(state.rngState);
  const results: MatchResult[] = [];
  let step = currentStep(state);
  if (!step) return results;
  results.push(...runStep(state, step, rng, userSim));
  if (step.kind === 'league') afterLeagueRound(state, rng);
  state.calendarIndex++;
  for (step = currentStep(state); step && step.kind !== 'league' && !userStepFixture(state, step); step = currentStep(state)) {
    runStep(state, step, rng);
    state.calendarIndex++;
  }
  state.rngState = rng.state();
  tickMarket(state); // ventanas de pases: mercado de la computadora, ofertas y listas (HTML 839-846); el día es la fecha de liga
  return results;
}

/**
 * Lo que pasa en cada fecha de liga además de los partidos: entrenamiento individual del usuario (HTML 1644, 2353), posibles
 * ofertas de trabajo (HTML 1906-1930) y el aviso de la directiva a mitad de temporada si el objetivo se escapa.
 */
function afterLeagueRound(state: GameState, rng: Rng): void {
  const me = userTeam(state);
  if (!me) return;
  processTraining(state, me, rng);
  rollJobOffers(state, rng);
  const div = state.userDivision && state.divisions[state.userDivision];
  if (div && div.matchday === BOARD.midSeasonCheck && objectiveOutlook(state) === 'risk') {
    pushNews(state, `📉 La directiva está preocupada: el objetivo se te está escapando (${standings(div.teams).findIndex((t) => t.id === me.id) + 1}° en la tabla).`);
  }
}

/**
 * Sin club: deja pasar el tiempo (una semana de pretemporada, un paso del calendario o el cambio de temporada) y puede
 * llegar alguna oferta nueva; si no queda ninguna, siempre llega una.
 */
export function waitForOffers(state: GameState): boolean {
  if (!state.dt.unemployed) return false;
  if (isSeasonOver(state)) startNewSeason(state);
  else if (isPreseason(state)) advancePreseason(state);
  else playNextStep(state);
  const rng = createRng(state.rngState);
  rollFreeAgentOffers(state, rng);
  state.rngState = rng.state();
  return true;
}

/** Avanza hasta haber jugado una fecha de liga (con los pasos de copa que la preceden, si los hay). */
export function playMatchday(state: GameState, userSim?: SimulatedMatch): MatchResult[] {
  const out: MatchResult[] = [];
  for (let guard = 0; guard < 100 && !isSeasonOver(state); guard++) {
    const wasLeague = currentStep(state)?.kind === 'league';
    out.push(...playNextStep(state, userSim));
    if (wasLeague) break;
  }
  return out;
}

/** La temporada termina cuando se jugó todo el calendario: liga, copas, playoffs y Copa de Campeones. */
export function isSeasonOver(state: GameState): boolean {
  return state.calendarIndex >= state.calendar.length;
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
  p.stats = { goals: 0, assists: 0, gamesPlayed: 0, yellowCards: 0, redCards: 0, cupGoals: 0 };
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
  for (const p of team.squad) {
    progressPlayer(p, rng);
    p.contractYears = Math.max(0, p.contractYears - 1);
  }
  team.squad = team.squad.filter((p) => {
    if (retires(p.age, rng)) {
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
  // Los que se fueron dejan de entrenar.
  const left = new Set(team.squad.map((p) => p.id));
  team.training = team.training.filter((id) => left.has(id));
  for (const id of Object.keys(team.trainingIntensity)) if (!left.has(id)) delete team.trainingIntensity[id];
  // Cantera (HTML 2045): promoción obligatoria a los 19 y tres chicos nuevos. Reemplaza a la reposición de retirados.
  const promoted = ageAcademy(state, team, isUser, rng);
  if (isUser && promoted.length > 0) {
    pushNews(state, `La cantera aportó ${promoted.length} jugador${promoted.length === 1 ? '' : 'es'} al plantel: ${promoted.map((p) => p.name).join(', ')}.`);
  }
  const before = team.squad.length;
  if (!team.squad.some((p) => p.pos === 'POR')) team.squad.push(youngster(team, 'POR', rng));
  while (team.squad.length < SQUAD.minSeason) {
    team.squad.push(youngster(team, rng.pick(['CIE', 'ALA', 'PIV'] as const), rng));
  }
  if (isUser && team.squad.length > before) {
    pushNews(state, `Se sumaron ${team.squad.length - before} jugador(es) del club para completar el plantel mínimo.`);
  }
  const ids = new Set(team.squad.map((p) => p.id));
  team.penaltyTakers = team.penaltyTakers.filter((id) => ids.has(id));
  team.record = emptyRecord();
  team.lineup = bestAvailableFive(team);
}

/**
 * Cierre de la temporada del usuario (HTML 1943-1956): resultado y objetivo cumplido o no. Queda en `seasonHistory`
 * (el bloque de la directiva usa `objectiveMet`).
 */
function closeSeasonForUser(state: GameState): void {
  const me = userTeam(state);
  const div = state.userDivision;
  if (!me || !div) return;
  const d = state.divisions[div];
  const position = standings(d.teams).findIndex((t) => t.id === me.id) + 1;
  const upper = div === 'B' ? 'A' : 'B';
  let outcome = `${position}° en la fase regular`;
  if (div === 'A' && d.playoff?.winner === me.id) outcome = '🏆 Campeón de los playoffs';
  else if (div !== 'A' && d.promotedDirect === me.id) outcome = `🎉 Campeón — ascenso directo a Primera ${upper}`;
  else if (div !== 'A' && d.playoff?.winner === me.id) outcome = `🎉 Ascenso vía playoff a Primera ${upper}`;
  else if (div !== 'C' && d.relegated?.includes(me.id)) outcome = `⬇️ Descenso a Primera ${div === 'A' ? 'B' : 'C'}`;
  state.seasonHistory.push({
    teamId: me.id,
    teamName: me.name,
    season: state.season,
    division: div,
    position,
    outcome,
    objective: state.objective,
    objectiveMet: evaluateObjective(state.objective, me.id, d, position),
  });
  if (state.seasonHistory.length > COMPETITIONS.historyMax) state.seasonHistory.shift();
  recordCareerSeason(state);
}

export function startNewSeason(state: GameState): void {
  // Si se pide cerrar antes de tiempo, se simula lo que falte.
  for (let guard = 0; guard < 200 && !isSeasonOver(state); guard++) playNextStep(state);
  ensureCompetitions(state);
  const rng = createRng(state.rngState);
  const userId = state.userTeamId;
  const oldDivision = state.userDivision;
  const D = state.divisions;

  closeSeasonForUser(state);
  const dismissed = shouldFire(state); // racha de objetivos fallados con este club (HTML 1999)
  state.dt.age = Math.min(80, state.dt.age + 1);
  state.lastSeasonAStandings = standings(D.A.teams).map((t) => t.id); // HTML 1963: define los byes de la copa

  // Ascensos y descensos (HTML 1966-1997): A y B bajan 2; el campeón de B y C asciende directo y el ganador de su
  // playoff, también; en C bajan 3 y los reemplazan equipos nuevos.
  const relA = D.A.relegated ?? [], relB = D.B.relegated ?? [], relC = D.C.relegated ?? [];
  const upToA = [D.B.promotedDirect, D.B.playoff?.winner].filter((x): x is string => !!x);
  const upToB = [D.C.promotedDirect, D.C.playoff?.winner].filter((x): x is string => !!x);
  const pick = (teams: Team[], ids: string[]) => teams.filter((t) => ids.includes(t.id));
  const aTeams = D.A.teams, bTeams = D.B.teams, cTeams = D.C.teams;
  const downFromA = pick(aTeams, relA), downFromB = pick(bTeams, relB);
  const next: Record<DivisionId, Team[]> = {
    A: [...aTeams.filter((t) => !relA.includes(t.id)), ...pick(bTeams, upToA)],
    B: [...bTeams.filter((t) => !relB.includes(t.id) && !upToA.includes(t.id)), ...downFromA, ...pick(cTeams, upToB)],
    C: [...cTeams.filter((t) => !upToB.includes(t.id)), ...downFromB],
  };
  const newTeamIds = new Set<string>();
  if (relC.length > 0) {
    const used = new Set(DIVISIONS.flatMap((d) => D[d].teams.map((t) => t.name)));
    const fresh = relC.map((_, i) => generateTeam(rng, used, 'C', i));
    for (const t of fresh) newTeamIds.add(t.id);
    next.C = [...next.C.filter((t) => !relC.includes(t.id)), ...fresh];
    // Los clubes que salen del juego no pueden seguir teniendo ofertas abiertas por jugadores del usuario.
    state.market.offers = state.market.offers.filter((o) => !relC.includes(o.teamId));
  }
  const names = (teams: Team[]) => teams.map((t) => t.name).join(', ');
  pushNews(state, `⬆️ Ascienden a Primera A: ${names(pick(bTeams, upToA))}. ⬇️ Descienden a B: ${names(downFromA)}.`);
  pushNews(state, `⬆️ Ascienden a Primera B: ${names(pick(cTeams, upToB))}. ⬇️ Descienden a C: ${names(downFromB)}.`);
  if (relC.length > 0) pushNews(state, `⬇️⬆️ En Primera C descendieron ${relC.length} equipos y llegaron ${relC.length} recién ascendidos.`);

  for (const d of DIVISIONS) {
    const div = D[d];
    div.teams = next[d];
    for (const t of div.teams) {
      // Los equipos recién generados ya nacen con la edad y el contrato de esta temporada.
      if (!newTeamIds.has(t.id)) rollTeamOver(state, t, t.id === userId, rng);
      // La computadora ajusta la entrada a su nueva división (si no, un equipo que asciende
      // cobraría precio de C contra la base de A). El usuario conserva el precio que eligió.
      if (t.id !== userId) t.finance.ticketPrice = defaultTicketPrice(d);
    }
    div.schedule = doubleRoundRobin(div.teams.map((t) => t.id));
    div.matchday = 0;
    div.results = [];
    div.phase = 'regular';
    div.playoff = null;
    div.promotedDirect = null;
    div.relegated = null;
    if (userId && div.teams.some((t) => t.id === userId)) state.userDivision = d;
  }
  // El DT queda libre: el club pasa a la computadora (firma sponsor abajo) y el usuario elige entre ofertas.
  if (dismissed) dismissUser(state, rng);

  state.season++;
  state.preseasonWeeksLeft = MARKET.preseasonWeeks; // HTML 2066
  // Competiciones de la temporada (HTML 2053-2065): la Internacional solo si hubo clasificado; copa nueva; sin Copa de Campeones.
  buildIntlCup(state, rng);
  if (state.intlCup) {
    const q = state.intlCupQualifiedNextSeason as string;
    pushNews(
      state,
      q === state.userTeamId
        ? '🌎 Clasificaste a la Copa Internacional: 12 equipos, 3 grupos de 4, se juega durante esta temporada.'
        : `🌎 ${findTeam(state, q)?.name ?? 'El campeón de A'} juega la Copa Internacional (12 equipos, 3 grupos de 4) esta temporada.`,
    );
  }
  state.intlCupQualifiedNextSeason = null;
  state.cup = buildCup(state, rng);
  state.championsCup = null;
  state.calendar = buildCalendar({ leagueRounds: D.A.schedule.length, cup: true, intl: !!state.intlCup });
  state.calendarIndex = 0;
  state.objective = computeSeasonObjective(state);

  // Sponsors de la nueva temporada: la computadora elige sola (la que más plata deja); el usuario elige en Club.
  for (const d of DIVISIONS) {
    for (const t of D[d].teams) {
      if (t.id === state.userTeamId) continue;
      signSponsor(t, pickBestOffer(generateSponsorOffers(t, rng), D[d].schedule.length), state.season);
    }
  }
  ensureSponsorOffers(state, rng);
  if (state.sponsorOffers?.season === state.season) pushNews(state, '🤝 Hay ofertas de auspiciantes para esta temporada: elegí una en Club.');
  if (state.userTeamId && oldDivision && state.userDivision !== oldDivision) {
    const up = DIVISIONS.indexOf(state.userDivision!) < DIVISIONS.indexOf(oldDivision);
    pushNews(
      state,
      up
        ? `¡Ascenso! Arrancás la temporada ${state.season} en la División ${state.userDivision}.`
        : `Descenso. Arrancás la temporada ${state.season} en la División ${state.userDivision}.`,
    );
  }
  if (state.objective) pushNews(state, `🎯 Objetivo de la temporada: ${state.objective.text}`);
  const pressure = boardPressure(state);
  if (pressure.text) pushNews(state, pressure.text);
  state.rngState = rng.state();
  tickMarket(state);
}
