// Fuerza de un equipo para un partido y ritmo del partido. Port de teamStrength / matchIntensity del HTML original.
import type { Formation, Player, Position, Press, Style, Team } from '../domain/types';

export const FORMATION_DELTA: Record<Formation, number> = {
  '2-2': 0, '4-0': 2.5, '1-2-1': 0.5, '2-1-1': -1, '1-1-2': 1.5,
};

/** Requisito de posición por slot de campo (el arquero, índice 0, siempre es POR). null = cualquiera. */
export const FORMATION_SLOTS: Record<Formation, (Position | null)[]> = {
  '2-2': [null, null, null, null],
  '4-0': [null, null, null, null],
  '1-2-1': ['CIE', 'ALA', 'ALA', 'PIV'],
  '2-1-1': ['CIE', 'CIE', 'ALA', 'PIV'],
  '1-1-2': ['CIE', 'ALA', 'PIV', 'PIV'],
};

export const FORMATION_META: Record<Formation, { attack: number; risk: number }> = {
  '2-2': { attack: 1.0, risk: 1.0 },
  '4-0': { attack: 1.3, risk: 1.25 },
  '1-2-1': { attack: 1.0, risk: 0.9 },
  '2-1-1': { attack: 0.8, risk: 0.75 },
  '1-1-2': { attack: 1.15, risk: 1.05 },
};

export const PRESS_META: Record<Press, { delta: number; fatigueMult: number }> = {
  alta: { delta: 1.5, fatigueMult: 1.35 },
  media: { delta: 0, fatigueMult: 1 },
  baja: { delta: -1, fatigueMult: 0.75 },
};

export const STYLE_INTENSITY: Record<Style, number> = { posesion: 0.85, equilibrado: 1, contragolpe: 1.2 };

/** Penalización a un jugador puesto en un slot que no es de su posición. */
export const MISMATCH_PENALTY = 8;

export function pressMatchupDelta(mine: Press, opp: Press): number {
  if (mine === 'alta' && opp === 'baja') return 2;
  if (mine === 'baja' && opp === 'alta') return -1.5;
  if (mine === 'alta' && opp === 'alta') return 0.5;
  if (mine === 'baja' && opp === 'baja') return 0.5;
  return 0;
}

export function getFullSlots(formation: Formation): (Position | null)[] {
  return ['POR', ...(FORMATION_SLOTS[formation] ?? [null, null, null, null])];
}

export function effectiveRating(p: Player): number {
  return p.rating + p.form - Math.floor(p.fatigue / 20);
}

export function lineupPlayers(team: Team): Player[] {
  return team.lineup
    .map((id) => team.squad.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
}

export function avgLineupRating(team: Team): number {
  const line = lineupPlayers(team);
  if (line.length === 0) return 60;
  return line.reduce((s, p) => s + p.rating, 0) / line.length;
}

export function teamStrength(team: Team, opponent?: Team): number {
  const slots = getFullSlots(team.tactic.formation);
  const ratings: number[] = [];
  team.lineup.forEach((id, i) => {
    const p = id ? team.squad.find((x) => x.id === id) : undefined;
    if (!p) return;
    let r = effectiveRating(p);
    const req = slots[i];
    if (req && p.pos !== req) r -= MISMATCH_PENALTY;
    ratings.push(r);
  });
  if (ratings.length === 0) return 60;
  let base = ratings.reduce((s, r) => s + r, 0) / ratings.length;

  base += FORMATION_DELTA[team.tactic.formation] ?? 0;
  base += opponent
    ? pressMatchupDelta(team.tactic.press, opponent.tactic.press)
    : PRESS_META[team.tactic.press]?.delta ?? 0;
  if (team.tactic.style === 'posesion') {
    base += avgLineupRating(team) >= 65 ? 3 : -2;
  } else if (team.tactic.style === 'contragolpe' && opponent) {
    if (avgLineupRating(opponent) > avgLineupRating(team)) base += 3;
  }
  base += Math.round((team.morale - 50) / 12);
  return base;
}

/** Multiplicador de ritmo del partido (afecta la cantidad de goles y eventos). 1 = normal. */
export function matchIntensity(home: Team, away: Team): number {
  const hf = FORMATION_META[home.tactic.formation] ?? FORMATION_META['2-2'];
  const af = FORMATION_META[away.tactic.formation] ?? FORMATION_META['2-2'];
  let mult = ((hf.attack + hf.risk) / 2 + (af.attack + af.risk) / 2) / 2;
  const hp = home.tactic.press, ap = away.tactic.press;
  if (hp === 'alta' && ap === 'alta') mult *= 1.15;
  else if (hp === 'baja' && ap === 'baja') mult *= 0.82;
  mult *= Math.sqrt((STYLE_INTENSITY[home.tactic.style] ?? 1) * (STYLE_INTENSITY[away.tactic.style] ?? 1));
  return mult;
}
