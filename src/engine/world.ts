// Consultas básicas sobre el estado de la partida (sin dependencias de otros módulos del motor,
// para que season.ts, market.ts y rivalry.ts puedan usarlas sin ciclos).
import type { DivisionId, GameState, MarketState, Team } from '../domain/types';

export const DIVISIONS: DivisionId[] = ['A', 'B', 'C'];
const MAX_NEWS = 30;

export function allTeams(state: GameState): Team[] {
  return DIVISIONS.flatMap((d) => state.divisions[d].teams);
}

/** Busca un equipo de las divisiones o, si no está, un invitado de la Copa Internacional (HTML 1285-1288). */
export function findTeam(state: GameState, id: string): Team | undefined {
  return allTeams(state).find((t) => t.id === id) ?? state.intlGuestTeams?.[id];
}

export const isGuestTeam = (state: GameState, id: string): boolean => !!state.intlGuestTeams?.[id];

export function userTeam(state: GameState): Team | undefined {
  return state.userTeamId ? findTeam(state, state.userTeamId) : undefined;
}

/** División en la que juega un equipo. */
export function teamDivision(state: GameState, teamId: string): DivisionId | undefined {
  return DIVISIONS.find((d) => state.divisions[d].teams.some((t) => t.id === teamId));
}

/** Agrega una noticia al principio de la bandeja (máx MAX_NEWS). */
export function pushNews(state: GameState, text: string): void {
  state.news.unshift(text);
  if (state.news.length > MAX_NEWS) state.news.length = MAX_NEWS;
}

export function emptyMarket(): MarketState {
  return { freeAgentsWindow: null, freeAgents: [], clubListings: [], dayKey: null, offers: [], aiDone: [], refused: [] };
}
