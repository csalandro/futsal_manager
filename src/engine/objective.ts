// Objetivo de temporada del usuario. Port de computeSeasonObjective / evaluateObjective (HTML 1544-1582).
// El resultado (`objectiveMet`) queda en `state.seasonHistory` para que el bloque de la directiva lo use.
import type { Division, GameState, SeasonObjective } from '../domain/types';
import { COMPETITIONS } from './config';
import { teamStrength } from './strength';
import { userTeam } from './world';

/** Objetivo según la fuerza del plantel dentro de su división: 4 primeros = "top", 4 últimos = "bottom", el resto "mid". */
export function computeSeasonObjective(state: GameState): SeasonObjective | null {
  const me = userTeam(state);
  const div = state.userDivision;
  if (!me || !div) return null;
  const strengths = state.divisions[div].teams
    .map((t) => ({ id: t.id, s: teamStrength(t) }))
    .sort((a, b) => b.s - a.s);
  const rank = strengths.findIndex((x) => x.id === me.id) + 1;
  const total = strengths.length;
  const tier = rank <= COMPETITIONS.objectiveTierSize ? 'top' : rank > total - COMPETITIONS.objectiveTierSize ? 'bottom' : 'mid';

  let text: string, type: SeasonObjective['type'];
  if (div === 'A') {
    if (tier === 'top') [text, type] = ['Pelear el título: llegar a la final de los playoffs.', 'title'];
    else if (tier === 'mid') [text, type] = [`Clasificar a los playoffs (entrar entre los ${COMPETITIONS.objectivePlayoffA} primeros).`, 'playoffs'];
    else [text, type] = [`Evitar el descenso: terminar afuera de los últimos ${COMPETITIONS.relegations.A} puestos.`, 'survive'];
  } else if (div === 'B') {
    if (tier === 'top') [text, type] = ['Conseguir el ascenso a Primera A.', 'promote'];
    else if (tier === 'mid') [text, type] = [`Meterte en el playoff de ascenso (entre los ${COMPETITIONS.objectivePlayoffB} primeros).`, 'playoff_promote'];
    else [text, type] = ['Evitar el descenso a Primera C.', 'survive'];
  } else if (tier === 'top') [text, type] = ['Conseguir el ascenso a Primera B.', 'promote'];
  else [text, type] = ['Terminar entre la mitad superior de la tabla.', 'top_half'];
  return { division: div, season: state.season, tier, type, text };
}

/** ¿Se cumplió? `pos` es el puesto final en la fase regular (1 = primero). */
export function evaluateObjective(obj: SeasonObjective | null, teamId: string, dObj: Division, pos: number): boolean | null {
  if (!obj) return null;
  switch (obj.type) {
    case 'title': return dObj.playoff?.winner === teamId;
    case 'playoffs': return pos <= COMPETITIONS.objectivePlayoffA;
    case 'promote': return dObj.promotedDirect === teamId || dObj.playoff?.winner === teamId;
    case 'playoff_promote': return pos <= COMPETITIONS.objectivePlayoffB;
    case 'survive': return !dObj.relegated?.includes(teamId);
    case 'top_half': return pos <= COMPETITIONS.objectiveTopHalf;
    default: return null;
  }
}
