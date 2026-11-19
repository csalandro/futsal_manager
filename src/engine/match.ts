// Motor de partido único: lo usan tanto el partido en vivo del usuario como los de la computadora.
// Goles ~ Poisson(λ), con λ derivado de la diferencia de fuerza. Los minutos de cada evento son
// uniformes en [1, 40] (proceso de Poisson homogéneo), así relato y resultado salen de la misma distribución.
import type { MatchEvent, MatchResult, Player, Team } from '../domain/types';
import {
  COMMENT_BUILD, COMMENT_CHANCE, COMMENT_FOUL, COMMENT_GOAL, COMMENT_RED, COMMENT_SAVE,
  COMMENT_YELLOW, fillScorer, fillTeams,
} from '../data/commentary';
import { MATCH } from './config';
import { outcomeProbabilities, samplePoisson } from './poisson';
import type { Rng } from './rng';
import { lineupPlayers, matchIntensity, teamStrength } from './strength';

export interface ExpectedGoals {
  home: number;
  away: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** λ local y visitante a partir de las fuerzas (con ventaja de localía) y la intensidad del partido. */
export function expectedGoals(
  homeStrength: number,
  awayStrength: number,
  intensity = 1,
  neutral = false,
): ExpectedGoals {
  const diff = homeStrength + (neutral ? 0 : MATCH.homeAdvantage) - awayStrength;
  const mu = MATCH.baseGoalsPerTeam * intensity;
  const k = MATCH.strengthSensitivity;
  return {
    home: clamp(mu * Math.exp(k * diff), MATCH.minLambda, MATCH.maxLambda),
    away: clamp(mu * Math.exp(-k * diff), MATCH.minLambda, MATCH.maxLambda),
  };
}

export function teamExpectedGoals(home: Team, away: Team, neutral = false): ExpectedGoals {
  return expectedGoals(teamStrength(home, away), teamStrength(away, home), matchIntensity(home, away), neutral);
}

export function matchOdds(home: Team, away: Team, neutral = false) {
  const xg = teamExpectedGoals(home, away, neutral);
  return { xg, ...outcomeProbabilities(xg.home, xg.away) };
}

const SCORER_WEIGHT: Record<Player['pos'], number> = { PIV: 4, ALA: 3, CIE: 1.5, POR: 0.1 };

function weightedPick(players: Player[], weight: (p: Player) => number, rng: Rng): Player | null {
  const total = players.reduce((s, p) => s + weight(p), 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const p of players) {
    r -= weight(p);
    if (r < 0) return p;
  }
  return players[players.length - 1];
}

export function pickScorer(team: Team, rng: Rng): Player | null {
  return weightedPick(lineupPlayers(team), (p) => SCORER_WEIGHT[p.pos] * Math.max(1, p.rating - 30), rng);
}

function pickAssist(team: Team, scorerId: string | null, rng: Rng): Player | null {
  if (rng.chance(0.3)) return null; // gol sin asistencia
  const others = lineupPlayers(team).filter((p) => p.id !== scorerId && p.pos !== 'POR');
  return weightedPick(others, (p) => Math.max(1, p.rating - 30), rng);
}

/** Minutos distintos al azar en [1, 40], ordenados. */
function randomMinutes(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => rng.int(1, MATCH.minutes)).sort((a, b) => a - b);
}

export interface SimOptions {
  /** Cancha neutral (sin ventaja local). */
  neutral?: boolean;
  /** Eliminatoria: si hay empate se define por penales. */
  knockout?: boolean;
}

export interface SimulatedMatch {
  result: MatchResult;
  events: MatchEvent[];
  xg: ExpectedGoals;
}

export function simulateMatch(home: Team, away: Team, rng: Rng, opts: SimOptions = {}): SimulatedMatch {
  const xg = teamExpectedGoals(home, away, opts.neutral);
  const hg = samplePoisson(xg.home, rng);
  const ag = samplePoisson(xg.away, rng);
  const events: MatchEvent[] = [];

  const sides = [
    { side: 'home' as const, team: home, opp: away, goals: hg },
    { side: 'away' as const, team: away, opp: home, goals: ag },
  ];

  for (const { side, team, opp, goals } of sides) {
    for (const minute of randomMinutes(goals, rng)) {
      const scorer = pickScorer(team, rng);
      const assist = pickAssist(team, scorer?.id ?? null, rng);
      const text =
        fillScorer(rng.pick(COMMENT_GOAL), scorer?.name ?? team.name) +
        ` (${team.name})` +
        (assist ? ` — asistencia de ${assist.name}` : '');
      events.push({ minute, type: 'goal', side, text, scorerId: scorer?.id ?? null, assistId: assist?.id ?? null });
    }
    const colour: [MatchEvent['type'], number, readonly string[]][] = [
      ['chance', MATCH.chancesPerTeam, COMMENT_CHANCE],
      ['save', MATCH.savesPerTeam, COMMENT_SAVE],
      ['build', MATCH.buildsPerTeam, COMMENT_BUILD],
    ];
    for (const [type, rate, tpls] of colour) {
      for (const minute of randomMinutes(samplePoisson(rate, rng), rng)) {
        events.push({ minute, type, side, text: fillTeams(rng.pick(tpls), team.name, opp.name) });
      }
    }
    // Faltas: las comete el rival (`opp`) sobre este equipo.
    for (const minute of randomMinutes(samplePoisson(MATCH.foulsPerTeam, rng), rng)) {
      const r = rng.next();
      const card = r < MATCH.redCardShare ? 'red' : r < MATCH.redCardShare + MATCH.yellowCardShare ? 'yellow' : null;
      const tpls = card === 'red' ? COMMENT_RED : card === 'yellow' ? COMMENT_YELLOW : COMMENT_FOUL;
      events.push({
        minute, type: 'foul', side: side === 'home' ? 'away' : 'home', card,
        text: fillTeams(rng.pick(tpls), team.name, opp.name),
      });
    }
  }

  events.sort((a, b) => a.minute - b.minute);

  const result: MatchResult = {
    homeId: home.id,
    awayId: away.id,
    hg,
    ag,
    scorers: events
      .filter((e) => e.type === 'goal')
      .map((e) => ({ teamId: e.side === 'home' ? home.id : away.id, playerId: e.scorerId ?? null, minute: e.minute })),
  };
  if (opts.knockout && hg === ag) result.penalties = penaltyShootout(home, away, rng);

  return { result, events, xg };
}

function goalkeeper(team: Team): Player | undefined {
  return lineupPlayers(team).find((p) => p.pos === 'POR');
}

/** Tanda de 5 penales por lado y luego muerte súbita. Mismo procedimiento para todos los equipos. */
export function penaltyShootout(home: Team, away: Team, rng: Rng): { home: number; away: number } {
  const takers = (t: Team) => {
    const field = lineupPlayers(t).filter((p) => p.pos !== 'POR').sort((a, b) => b.rating - a.rating);
    return field.length ? field : lineupPlayers(t);
  };
  const ht = takers(home), at = takers(away);
  const hk = goalkeeper(home), ak = goalkeeper(away);
  const shot = (taker: Player | undefined, keeper: Player | undefined) => {
    const diff = (taker?.rating ?? 60) - (keeper?.rating ?? 60);
    return rng.chance(clamp(MATCH.penaltyBase + MATCH.penaltySensitivity * diff, 0.45, 0.95));
  };
  let h = 0, a = 0;
  for (let i = 0; i < 5; i++) {
    if (shot(ht[i % ht.length], ak)) h++;
    if (shot(at[i % at.length], hk)) a++;
    const left = 4 - i;
    if (h > a + left || a > h + left) break; // definida antes de terminar
  }
  for (let i = 5; h === a && i < 50; i++) {
    if (shot(ht[i % ht.length], ak)) h++;
    if (shot(at[i % at.length], hk)) a++;
  }
  if (h === a) h++; // salvaguarda teórica
  return { home: h, away: a };
}

export function winnerId(r: MatchResult): string | null {
  if (r.hg !== r.ag) return r.hg > r.ag ? r.homeId : r.awayId;
  if (r.penalties) return r.penalties.home > r.penalties.away ? r.homeId : r.awayId;
  return null;
}
