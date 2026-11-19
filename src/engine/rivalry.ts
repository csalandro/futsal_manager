// Historial entre equipos (h2h) y clásico del usuario. Port de HTML 497-517 y 1198-1207.
// Las funciones que reciben GameState lo MUTAN (se llaman dentro de immer).
import type { GameState, H2HRecord } from '../domain/types';
import { RIVALRY } from './config';
import { allTeams, teamDivision } from './world';

export function h2hKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Suma un partido al historial del par (se guarda para todos los pares; el original solo para el usuario, HTML 1198-1207). */
export function recordH2H(state: GameState, homeId: string, awayId: string, hg: number, ag: number): void {
  const key = h2hKey(homeId, awayId);
  const [first, second] = homeId < awayId ? [homeId, awayId] : [awayId, homeId];
  const rec: H2HRecord = (state.h2h[key] ??= {
    first, second, firstWins: 0, draws: 0, secondWins: 0, firstGoals: 0, secondGoals: 0,
  });
  const fg = first === homeId ? hg : ag;
  const sg = first === homeId ? ag : hg;
  rec.firstGoals += fg;
  rec.secondGoals += sg;
  if (fg > sg) rec.firstWins++;
  else if (fg < sg) rec.secondWins++;
  else rec.draws++;
}

export interface H2HView {
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
}

/** Historial visto desde `teamId` contra `oppId`. */
export function h2hFor(state: GameState, teamId: string, oppId: string): H2HView {
  const rec = state.h2h[h2hKey(teamId, oppId)];
  if (!rec) return { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  const me = rec.first === teamId;
  const w = me ? rec.firstWins : rec.secondWins;
  const l = me ? rec.secondWins : rec.firstWins;
  return {
    played: w + l + rec.draws, w, d: rec.draws, l,
    gf: me ? rec.firstGoals : rec.secondGoals, ga: me ? rec.secondGoals : rec.firstGoals,
  };
}

/**
 * Rival (clásico) del usuario (HTML 497-512): entre los que enfrentó al menos `minMatches` veces,
 * el de mayor `partidos + parejo·3`, donde parejo = 1 - |%victorias - 0,5|·2.
 */
export function getUserRivalId(state: GameState): string | null {
  const me = state.userTeamId;
  if (!me) return null;
  let bestId: string | null = null;
  let bestScore = -1;
  for (const t of allTeams(state)) {
    if (t.id === me) continue;
    const h = h2hFor(state, me, t.id);
    if (h.played < RIVALRY.minMatches) continue;
    const balance = 1 - Math.abs(h.w / h.played - 0.5) * 2;
    const score = h.played + balance * RIVALRY.balanceWeight;
    if (score > bestScore) {
      bestScore = score;
      bestId = t.id;
    }
  }
  return bestId;
}

/** ¿Es el clásico del usuario? (HTML 513-518) */
export function isRivalMatch(state: GameState, homeId: string, awayId: string): boolean {
  const rival = getUserRivalId(state);
  const me = state.userTeamId;
  if (!rival || !me) return false;
  return (homeId === me && awayId === rival) || (awayId === me && homeId === rival);
}

export type Outcome = 'G' | 'E' | 'P';

/** Últimos resultados de un equipo en la liga de esta temporada, del más viejo al más nuevo. */
export function recentResults(state: GameState, teamId: string, n = 5): { outcome: Outcome; score: string; rival: string }[] {
  const d = teamDivision(state, teamId);
  if (!d) return [];
  const div = state.divisions[d];
  const names = new Map(div.teams.map((t) => [t.id, t.name]));
  const out: { outcome: Outcome; score: string; rival: string }[] = [];
  for (const round of div.results) {
    const r = round.find((m) => m.homeId === teamId || m.awayId === teamId);
    if (!r) continue;
    const home = r.homeId === teamId;
    const mine = home ? r.hg : r.ag;
    const theirs = home ? r.ag : r.hg;
    out.push({
      outcome: mine > theirs ? 'G' : mine < theirs ? 'P' : 'E',
      score: `${mine}-${theirs}`,
      rival: names.get(home ? r.awayId : r.homeId) ?? '',
    });
  }
  return out.slice(-n);
}
