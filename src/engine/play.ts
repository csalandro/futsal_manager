// Partido y consecuencias, comunes a la liga, las copas y los playoffs: resultado, estadísticas, moral, forma,
// sanciones, lesiones, fatiga, h2h y plata del local. Las funciones MUTAN el estado (se llaman dentro de immer).
//
// Las sanciones y las lesiones son GLOBALES, no por competición: el original no las distingue (HTML 724-762, processCards
// corre después de cada partido de liga, copa, internacional y playoffs sobre los mismos `suspended`/`injury`).
// Cada partido que juega un equipo descuenta una fecha de sanción o de lesión de los que ya la tenían.
import type { DivisionId, GameState, MatchEvent, MatchResult, Team } from '../domain/types';
import { DISCIPLINE, FORM } from './config';
import { computeAttendance, medicalLevels, medicRecoveryMult, processClubFinances } from './finance';
import { simulateMatch, type SimulatedMatch } from './match';
import { isRivalMatch, recordH2H } from './rivalry';
import type { Rng } from './rng';
import { bestAvailableFive } from './squad';
import { applyResult } from './standings';
import { PRESS_META } from './strength';
import { isGuestTeam, pushNews, teamDivision } from './world';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function updateMorale(team: Team, outcome: 'win' | 'draw' | 'loss', rng: Rng): void {
  if (outcome === 'win') team.morale = Math.min(100, team.morale + rng.int(4, 8));
  else if (outcome === 'draw') team.morale = Math.max(0, Math.min(100, team.morale + rng.int(-1, 1)));
  else team.morale = Math.max(0, team.morale - rng.int(4, 8));
}

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

/** Estadísticas de jugador; los goles de copa y playoffs también se cuentan aparte en `cupGoals` (para la tabla de goleadores). */
function recordPlayerStats(team: Team, result: MatchResult, events: MatchEvent[], official: boolean): void {
  const byId = new Map(team.squad.map((p) => [p.id, p]));
  for (const id of team.lineup) {
    const p = id ? byId.get(id) : undefined;
    if (p) p.stats.gamesPlayed++;
  }
  for (const s of result.scorers) {
    if (s.teamId === team.id && s.playerId) {
      const p = byId.get(s.playerId);
      if (!p) continue;
      p.stats.goals++;
      if (!official) p.stats.cupGoals = (p.stats.cupGoals ?? 0) + 1;
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

/** Resultado de un equipo; en una eliminatoria empatada gana quien ganó los penales (HTML 1464-1471: el que gana por penales suma 1 gol). */
export function outcomeOf(r: { hg: number; ag: number; penalties?: { home: number; away: number } }, side: 'home' | 'away'): 'win' | 'draw' | 'loss' {
  const mine = side === 'home' ? r.hg : r.ag, theirs = side === 'home' ? r.ag : r.hg;
  if (mine !== theirs) return mine > theirs ? 'win' : 'loss';
  if (r.penalties) {
    const pm = side === 'home' ? r.penalties.home : r.penalties.away, pt = side === 'home' ? r.penalties.away : r.penalties.home;
    return pm > pt ? 'win' : 'loss';
  }
  return 'draw';
}

function userOutcomeText(state: GameState, home: Team, away: Team, r: MatchResult, label: string): string {
  const isHome = home.id === state.userTeamId;
  const mine = isHome ? r.hg : r.ag, theirs = isHome ? r.ag : r.hg;
  const rival = isHome ? away.name : home.name;
  const verb = mine > theirs ? 'Ganaste' : mine < theirs ? 'Perdiste' : 'Empataste';
  const prep = mine === theirs ? 'con' : 'ante';
  let text = `${label}: ${verb} ${mine}-${theirs} ${prep} ${rival}.`;
  if (r.penalties) {
    const pm = isHome ? r.penalties.home : r.penalties.away, pt = isHome ? r.penalties.away : r.penalties.home;
    text += pm > pt ? ` Ganaste ${pm}-${pt} por penales.` : ` Perdiste ${pm}-${pt} por penales.`;
  }
  return text;
}

export interface FixtureCtx {
  rng: Rng;
  /** Cómo se llama el partido en noticias y movimientos de plata ("Fecha 7", "Copa · Octavos de final"). */
  label: string;
  /** Eliminatoria: si hay empate se define por penales. */
  knockout: boolean;
  /** Solo la liga: suma a la tabla de la división y cobra con el número de fecha. */
  league: { division: DivisionId; matchday: number } | null;
  /** Partido del usuario ya jugado en vivo; se usa si coincide con este cruce. */
  userSim?: SimulatedMatch;
}

/**
 * Juega UN partido de cualquier competición y aplica todas las consecuencias: tabla (solo liga), estadísticas de
 * jugador, moral, forma, sanciones, lesiones, fatiga, h2h y finanzas de ambos clubes (HTML 563-592: la entrada la cobra el
 * local, sponsor/sueldos/mantenimiento los pagan los dos; los invitados de la Internacional no llevan contabilidad).
 */
export function playFixture(state: GameState, home: Team, away: Team, ctx: FixtureCtx): MatchResult {
  const { rng } = ctx;
  const userId = state.userTeamId;
  const isUser = userId !== null && (home.id === userId || away.id === userId);
  // La computadora arma su alineación con los disponibles antes de cada partido.
  for (const t of [home, away]) if (t.id !== userId) t.lineup = bestAvailableFive(t);
  const sim =
    isUser && ctx.userSim && ctx.userSim.result.homeId === home.id && ctx.userSim.result.awayId === away.id
      ? ctx.userSim
      : simulateMatch(home, away, rng, { knockout: ctx.knockout, medicalLevel: medicalLevels(home, away) });
  const r = sim.result;

  if (ctx.league) applyResult(home, away, r);
  const official = ctx.league !== null;
  recordPlayerStats(home, r, sim.events, official);
  recordPlayerStats(away, r, sim.events, official);
  const ho = outcomeOf(r, 'home'), ao = outcomeOf(r, 'away');
  updateMorale(home, ho, rng);
  updateMorale(away, ao, rng);
  const scorerIds = (teamId: string) =>
    new Set(r.scorers.filter((x) => x.teamId === teamId && x.playerId).map((x) => x.playerId as string));
  updateForm(home, ho, scorerIds(home.id));
  updateForm(away, ao, scorerIds(away.id));
  applyDisciplineAndInjuries(state, home, 'home', sim.events, home.id === userId);
  applyDisciplineAndInjuries(state, away, 'away', sim.events, away.id === userId);
  updateFatigue(home);
  updateFatigue(away);

  // Plata (HTML 563-592): la asistencia sale del estadio del local; clásico del usuario (HTML 1176) con el h2h previo.
  const division = ctx.league?.division ?? teamDivision(state, home.id) ?? 'C';
  const attendance = computeAttendance(home, division, rng, isRivalMatch(state, home.id, away.id));
  for (const t of [home, away]) {
    if (isGuestTeam(state, t.id)) continue;
    const mine = t.id === userId;
    processClubFinances(
      t,
      {
        season: state.season,
        matchday: ctx.league ? ctx.league.matchday : null,
        label: ctx.league ? undefined : ctx.label,
        isHome: t === home,
        attendance,
      },
      mine,
      mine ? (text) => pushNews(state, text) : undefined,
    );
  }
  if (!isGuestTeam(state, home.id) && !isGuestTeam(state, away.id)) recordH2H(state, home.id, away.id, r.hg, r.ag);
  if (isUser) pushNews(state, userOutcomeText(state, home, away, r, ctx.label));
  return r;
}
