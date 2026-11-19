// El DT: carrera, historial por club, presión de la directiva, despido y ofertas de trabajo.
// Port de recordDtResult (HTML 1353-1359), fireAndReassignUser / ensureDtJobOffers / acceptDtJobOffer (HTML 1893-1942),
// racha de objetivos fallados (HTML 1957-1962, 1999-2001) y renderDtProfile / renderClub (HTML 3661-3669, 3712-3827).
// Las funciones que reciben GameState lo MUTAN (se llaman dentro de immer). Este módulo no importa season.ts.
import type { ClubTenure, GameState, Team } from '../domain/types';
import { BOARD, COMPETITIONS, JOB_OFFERS, MARKET } from './config';
import { defaultTicketPrice, ensureSponsorOffers, generateSponsorOffers, pickBestOffer, signSponsor } from './finance';
import { refreshWatchlist, tickMarket } from './market';
import { computeSeasonObjective } from './objective';
import { createRng, shuffle, type Rng } from './rng';
import { bestAvailableFive, type ActionResult } from './squad';
import { standings } from './standings';
import { findTeam, pushNews, teamDivision, userTeam } from './world';

export const DT_NAME_MAX = 24; // HTML 3724: maxlength="24"
export const DT_AGE_RANGE = [25, 80] as const; // HTML 3747: min 25, max 80

// ---------------------------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------------------------

/** Nombre del DT: recortado a 24; vacío = "DT" (HTML 3730). */
export function renameDt(state: GameState, name: string): void {
  state.dtName = name.trim().slice(0, DT_NAME_MAX) || 'DT';
}

/** Edad del DT, entre 25 y 80 (HTML 3751). */
export function setDtAge(state: GameState, age: number): void {
  const v = Math.round(age);
  state.dt.age = Math.max(DT_AGE_RANGE[0], Math.min(DT_AGE_RANGE[1], Number.isFinite(v) ? v : 45));
}

// ---------------------------------------------------------------------------------------------
// Carrera e historial por club
// ---------------------------------------------------------------------------------------------

/** Paso vigente por el club del usuario; lo abre si todavía no existe (partidas armadas a mano, migradas o recién asignadas). */
export function openTenure(state: GameState): ClubTenure | undefined {
  const me = userTeam(state);
  if (!me) return undefined;
  const list = state.dt.tenures;
  const last = list[list.length - 1];
  if (last && last.teamId === me.id && last.toSeason === null) return last;
  if (last && last.toSeason === null) last.toSeason = state.season;
  list.push({ teamId: me.id, teamName: me.name, fromSeason: state.season, toSeason: null, matches: 0, wins: 0, draws: 0, losses: 0, seasons: 0 });
  if (list.length > JOB_OFFERS.tenuresMax) list.shift();
  return list[list.length - 1];
}

function closeTenure(state: GameState): void {
  const t = state.dt.tenures[state.dt.tenures.length - 1];
  if (t && t.toSeason === null) t.toSeason = state.season;
}

/** Suma un partido (de cualquier competición) a la carrera y al club vigente (HTML 1353-1359). */
export function recordCareerMatch(state: GameState, outcome: 'win' | 'draw' | 'loss'): void {
  const targets = [state.dt.career, openTenure(state)];
  for (const c of targets) {
    if (!c) continue;
    c.matches++;
    if (outcome === 'win') c.wins++;
    else if (outcome === 'draw') c.draws++;
    else c.losses++;
  }
}

/** Una temporada completa dirigida (HTML 2067-2068). */
export function recordCareerSeason(state: GameState): void {
  state.dt.career.seasons++;
  const t = openTenure(state);
  if (t) t.seasons++;
}

/** Títulos del DT: todos, o solo los de un club (los anteriores a la v6 no tienen club: se le atribuyen al primero). */
export function titlesOf(state: GameState, teamId?: string): GameState['titles'] {
  if (!teamId) return state.titles;
  const first = state.dt.tenures[0]?.teamId;
  return state.titles.filter((t) => (t.teamId ?? first) === teamId);
}

// ---------------------------------------------------------------------------------------------
// Directiva (HTML 3661-3669, 1957-1962, 1999-2001)
// ---------------------------------------------------------------------------------------------

/** Temporadas seguidas sin cumplir el objetivo con el club actual (HTML 1958-1962). */
export function failureStreak(state: GameState): number {
  const me = state.userTeamId;
  if (!me) return 0;
  const from = state.dt.tenures[state.dt.tenures.length - 1]?.teamId === me ? state.dt.tenures[state.dt.tenures.length - 1].fromSeason : 0;
  let n = 0;
  for (let i = state.seasonHistory.length - 1; i >= 0; i--) {
    const r = state.seasonHistory[i];
    if ((r.teamId && r.teamId !== me) || r.season < from) break;
    if (r.objectiveMet === false) n++;
    else break;
  }
  return n;
}

/** Con la racha alcanzada la directiva echa al DT (HTML 1999). */
export function shouldFire(state: GameState): boolean {
  return !!state.userTeamId && failureStreak(state) >= BOARD.firingStreak;
}

/** ¿Va camino de cumplir el objetivo? Solo desde mitad de temporada y en la fase regular; null si no hay nada que evaluar. */
export function objectiveOutlook(state: GameState): 'ok' | 'risk' | null {
  const obj = state.objective, div = state.userDivision, me = state.userTeamId;
  if (!obj || !div || !me) return null;
  const d = state.divisions[div];
  if (d.phase !== 'regular' || d.matchday < BOARD.midSeasonCheck) return null;
  const pos = standings(d.teams).findIndex((t) => t.id === me) + 1;
  if (pos === 0) return null;
  let limit: number;
  switch (obj.type) {
    case 'title':
    case 'playoffs':
      limit = COMPETITIONS.objectivePlayoffA;
      break;
    case 'promote':
    case 'playoff_promote':
      limit = COMPETITIONS.objectivePlayoffB;
      break;
    case 'survive':
      limit = d.teams.length - COMPETITIONS.relegations[div];
      break;
    case 'top_half':
      limit = COMPETITIONS.objectiveTopHalf;
      break;
    default:
      return null;
  }
  return pos <= limit ? 'ok' : 'risk';
}

export type PressureLevel = 'none' | 'impatient' | 'ultimatum' | 'critical';

export interface BoardPressure {
  streak: number;
  level: PressureLevel;
  /** Mensaje de la directiva por la racha (HTML 3663-3667); null si no hay presión. */
  text: string | null;
  /** Estado del objetivo de esta temporada (solo desde mitad de campeonato). */
  outlook: 'ok' | 'risk' | null;
}

export function boardPressure(state: GameState): BoardPressure {
  const streak = failureStreak(state);
  const outlook = objectiveOutlook(state);
  if (streak === 0) return { streak, level: 'none', text: null, outlook };
  if (streak === 1) {
    return { streak, level: 'impatient', text: '⚠️ La directiva empieza a impacientarse: no cumpliste el objetivo la temporada pasada.', outlook };
  }
  if (streak === 2) {
    return { streak, level: 'ultimatum', text: '🔴 Ultimátum: si no cumplís el objetivo esta temporada, te van a despedir.', outlook };
  }
  return { streak, level: 'critical', text: '🔴 Situación crítica con la directiva.', outlook };
}

// ---------------------------------------------------------------------------------------------
// Ofertas de trabajo (HTML 1906-1942)
// ---------------------------------------------------------------------------------------------

/** Reputación en puntos porcentuales: 3 por título + 8 × % de victorias (HTML 1914-1917). */
export function dtReputation(state: GameState): number {
  const c = state.dt.career;
  const rate = c.matches > 0 ? c.wins / c.matches : JOB_OFFERS.defaultWinRate;
  return (state.titles.length * JOB_OFFERS.perTitle + rate * JOB_OFFERS.perWinRate) * 100;
}

/** Clubes que pueden ofrecer trabajo: hasta el nivel de `baseRank` más lo que permite la reputación. */
/**
 * Clubes de C que ya descendieron y van a ser reemplazados al cerrar la temporada: no pueden ofrecerle trabajo
 * al DT (si los aceptara, el club desaparecería con él adentro).
 */
export function isDoomedClub(state: GameState, teamId: string): boolean {
  return (state.divisions.C.relegated ?? []).includes(teamId);
}

/** Ofertas de trabajo vigentes (clubes que siguen existiendo y no están condenados). */
export function openJobOffers(state: GameState) {
  return validOffers(state, state.userTeamId);
}

function offerCandidates(state: GameState, baseRank: number, exclude: string[]): Team[] {
  const rep = dtReputation(state);
  const reach = baseRank + (rep >= JOB_OFFERS.upTwoLevels ? 2 : rep >= JOB_OFFERS.upOneLevel ? 1 : 0);
  return (['A', 'B', 'C'] as const)
    .filter((d) => MARKET.divRank[d] <= reach)
    .flatMap((d) => state.divisions[d].teams)
    .filter((t) => !exclude.includes(t.id) && !isDoomedClub(state, t.id));
}

function validOffers(state: GameState, exclude: string | null) {
  return state.dt.jobOffers.filter(
    (o) => o.teamId !== exclude && teamDivision(state, o.teamId) !== undefined && !isDoomedClub(state, o.teamId),
  );
}

/**
 * Con club: como máximo 2 ofertas abiertas; en cada fecha (una sola vez por día) hay una chance de 5% + 3% por título +
 * 8% × % de victorias de que llegue una (HTML 1906-1930).
 */
export function rollJobOffers(state: GameState, rng: Rng): void {
  const me = userTeam(state), div = state.userDivision;
  if (!me || !div || state.dt.unemployed) return;
  const key = `${state.season}:${state.divisions[div].matchday}:${state.preseasonWeeksLeft}`;
  if (state.dt.offersKey === key) return;
  state.dt.offersKey = key;
  state.dt.jobOffers = validOffers(state, me.id);
  if (state.dt.jobOffers.length >= JOB_OFFERS.maxOpen) return;
  if (!rng.chance(JOB_OFFERS.baseChance + dtReputation(state) / 100)) return;
  const cands = offerCandidates(state, MARKET.divRank[div], [me.id, ...state.dt.jobOffers.map((o) => o.teamId)]);
  if (cands.length === 0) return;
  const club = rng.pick(cands);
  state.dt.jobOffers.push({ teamId: club.id, season: state.season });
  pushNews(state, `📩 ${club.name} te ofreció dirigirlos.`);
}

/** Sin club: cada espera puede traer una oferta nueva, y si no queda ninguna, siempre llega una. */
export function rollFreeAgentOffers(state: GameState, rng: Rng): void {
  const fired = state.dt.fired;
  if (!state.dt.unemployed) return;
  state.dt.jobOffers = validOffers(state, fired?.clubId ?? null);
  const have = state.dt.jobOffers.length;
  if (have >= JOB_OFFERS.firedOffers) return;
  if (have > 0 && !rng.chance(JOB_OFFERS.freeAgentChance)) return;
  const rank = fired ? MARKET.divRank[fired.division] : 1;
  const cands = offerCandidates(state, rank, [fired?.clubId ?? '', ...state.dt.jobOffers.map((o) => o.teamId)]);
  if (cands.length === 0) return;
  const club = rng.pick(cands);
  state.dt.jobOffers.push({ teamId: club.id, season: state.season });
  pushNews(state, `📩 ${club.name} te ofreció dirigirlos.`);
}

/** El club que el usuario deja pasa a manejarse solo: sin lista de transferibles ni entrenamiento, con alineación y sponsor de la computadora. */
function releaseClubToAi(state: GameState, team: Team, rng: Rng, withSponsor: boolean): void {
  for (const p of team.squad) delete p.transferListed;
  team.training = [];
  team.trainingIntensity = {};
  team.lineup = bestAvailableFive(team);
  const div = teamDivision(state, team.id);
  if (div) team.finance.ticketPrice = defaultTicketPrice(div);
  if (withSponsor && div && team.finance.sponsor.season < state.season) {
    signSponsor(team, pickBestOffer(generateSponsorOffers(team, rng), state.divisions[div].schedule.length), state.season);
  }
}

/** Limpia lo que estaba atado al club anterior. La cartera se purga sola con `refreshWatchlist` (no deja seguidos del club propio). */
function clearClubBoundState(state: GameState): void {
  state.sponsorOffers = null;
  state.market.offers = [];
  state.market.refused = [];
  state.objective = null;
}

/**
 * Despido al cerrar la temporada (HTML 1893-1904, 1999-2001). A diferencia del original, que reasigna un club al azar, el DT
 * queda libre con 3 ofertas para elegir (o espera más). El club anterior pasa a la computadora y el usuario deja de tener club
 * (`userTeamId` y `userDivision` en null), sin ids colgados en el mercado ni en el objetivo.
 */
export function dismissUser(state: GameState, rng: Rng): void {
  const me = userTeam(state);
  if (!me) return;
  const div = teamDivision(state, me.id) ?? state.userDivision ?? 'C';
  pushNews(state, `🔥 La directiva de ${me.name} decidió separarte del cargo tras ${BOARD.firingStreak} temporadas sin cumplir el objetivo.`);
  closeTenure(state);
  releaseClubToAi(state, me, rng, false); // el sponsor de la nueva temporada lo firma la computadora al cerrar el cambio de año
  state.dt.unemployed = true;
  state.dt.fired = { club: me.name, clubId: me.id, season: state.season, division: div };
  state.userTeamId = null;
  state.userDivision = null;
  clearClubBoundState(state);
  state.dt.offersKey = null;
  const cands = shuffle(offerCandidates(state, MARKET.divRank[div], [me.id]), rng).slice(0, JOB_OFFERS.firedOffers);
  state.dt.jobOffers = cands.map((t) => ({ teamId: t.id, season: state.season }));
  pushNews(state, `📩 Quedaste libre. ${cands.length} club${cands.length === 1 ? '' : 'es'} te ofrecieron dirigirlos: elegí uno o esperá otras ofertas.`);
}

/**
 * Acepta una oferta (HTML 1931-1942): deja el club actual (si lo hay) y pasa a dirigir al nuevo. El club anterior pasa a la
 * computadora y se limpia lo atado a él: ofertas de mercado, ofertas de sponsor, transferibles y objetivo.
 */
export function acceptJobOffer(state: GameState, teamId: string): ActionResult {
  if (!state.dt.jobOffers.some((o) => o.teamId === teamId)) return { ok: false, reason: 'Esa oferta ya no está disponible.' };
  const club = findTeam(state, teamId), div = teamDivision(state, teamId);
  if (!club || !div || teamId === state.userTeamId) return { ok: false, reason: 'Ese club no está disponible.' };
  if (isDoomedClub(state, teamId)) return { ok: false, reason: `${club.name} ya descendió y deja la competencia.` };
  const rng = createRng(state.rngState);
  const old = userTeam(state);
  if (old) {
    closeTenure(state);
    releaseClubToAi(state, old, rng, true);
    pushNews(state, `✍️ Dejaste ${old.name} para dirigir a ${club.name}.`);
  }
  clearClubBoundState(state);
  for (const p of club.squad) delete p.transferListed;
  state.userTeamId = club.id;
  state.userDivision = div;
  state.dt.unemployed = false;
  state.dt.jobOffers = [];
  state.dt.offersKey = null;
  club.lineup = bestAvailableFive(club);
  openTenure(state);
  state.objective = computeSeasonObjective(state);
  state.rngState = rng.state();
  ensureSponsorOffers(state);
  state.market.dayKey = null; // fuerza a rearmar las listas de la ventana sin el club nuevo
  tickMarket(state);
  refreshWatchlist(state);
  pushNews(state, `🎉 ${club.name} te da la bienvenida como nuevo DT.`);
  return { ok: true, cost: 0 };
}

export function rejectJobOffer(state: GameState, teamId: string): void {
  state.dt.jobOffers = state.dt.jobOffers.filter((o) => o.teamId !== teamId);
}
