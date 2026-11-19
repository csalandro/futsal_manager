// Motor de partido único: lo usan tanto el partido en vivo del usuario como los de la computadora.
// Goles ~ Poisson(λ), con λ derivado de la diferencia de fuerza. Los minutos de cada evento son
// uniformes en cada tiempo (proceso de Poisson homogéneo), así relato y resultado salen de la misma distribución.
// El partido se arma en dos tiempos (simulateHalf) para permitir cambios tácticos en el entretiempo.
import type { MatchEvent, MatchResult, Player, Team } from '../domain/types';
import {
  COMMENT_BUILD, COMMENT_CHANCE, COMMENT_FOUL, COMMENT_GOAL, COMMENT_RED, COMMENT_SAVE,
  COMMENT_YELLOW, fillScorer, fillTeams,
} from '../data/commentary';
import { INJURY, MATCH } from './config';
import { outcomeProbabilities, samplePoisson } from './poisson';
import type { Rng } from './rng';
import { availableGkCount } from './squad';
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

/** Minutos al azar en [from, to], ordenados. */
function randomMinutes(n: number, from: number, to: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => rng.int(from, to)).sort((a, b) => a - b);
}

export interface SimOptions {
  /** Cancha neutral (sin ventaja local). */
  neutral?: boolean;
  /** Eliminatoria: si hay empate se define por penales. */
  knockout?: boolean;
  /**
   * Nivel del cuerpo médico de cada equipo (team.staff.doctors): acorta las lesiones un 12% por nivel (HTML 700).
   * Lo completan playMatchday y la tienda con `medicalLevels(home, away)` (finance.ts).
   */
  medicalLevel?: { home?: number; away?: number };
}

export interface SimulatedMatch {
  result: MatchResult;
  events: MatchEvent[];
  xg: ExpectedGoals;
}

/** Un tiempo de 20 minutos. `xg` son los goles esperados de ESTE tiempo (λ/2). */
export interface HalfResult {
  half: 1 | 2;
  hg: number;
  ag: number;
  events: MatchEvent[];
  xg: ExpectedGoals;
}

function pickInjuryType(rng: Rng) {
  const total = INJURY.types.reduce((s, t) => s + t.weight, 0);
  let r = rng.next() * total;
  for (const t of INJURY.types) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return INJURY.types[0];
}

/** Port de checkInjuries (HTML 687-706): tipo por peso, duración uniforme reducida por el médico. */
function rollInjury(rng: Rng, medicalLevel: number): { type: string; matchesLeft: number } {
  const t = pickInjuryType(rng);
  const matchesLeft = Math.max(1, Math.round(rng.int(t.min, t.max) * (1 - medicalLevel * INJURY.medicalReduction)));
  return { type: t.name, matchesLeft };
}

/** Elige al infractor: un titular de campo (si no hay, cualquiera de la alineación). */
function pickFouler(team: Team, rng: Rng): Player | null {
  const line = lineupPlayers(team);
  const field = line.filter((p) => p.pos !== 'POR');
  const pool = field.length ? field : line;
  return pool.length ? rng.pick(pool) : null;
}

function halfRange(half: 1 | 2): [number, number] {
  const h = MATCH.minutes / 2;
  return half === 1 ? [1, h] : [h + 1, MATCH.minutes];
}

/**
 * Simula un tiempo. Goles ~ Poisson(λ/2) y eventos de color con la mitad de la tasa del partido,
 * así la suma de los dos tiempos tiene la misma distribución que un partido entero.
 * `prior`: eventos del primer tiempo (para no lesionar dos veces al mismo jugador).
 */
export function simulateHalf(
  home: Team,
  away: Team,
  rng: Rng,
  half: 1 | 2,
  opts: SimOptions & { prior?: MatchEvent[] } = {},
): HalfResult {
  const full = teamExpectedGoals(home, away, opts.neutral);
  const xg = { home: full.home / 2, away: full.away / 2 };
  const hg = samplePoisson(xg.home, rng);
  const ag = samplePoisson(xg.away, rng);
  const events: MatchEvent[] = [];
  const [from, to] = halfRange(half);
  const injured = new Set(
    (opts.prior ?? []).filter((e) => e.type === 'injury' && e.playerId).map((e) => e.playerId as string),
  );

  const sides = [
    { side: 'home' as const, team: home, opp: away, goals: hg },
    { side: 'away' as const, team: away, opp: home, goals: ag },
  ];

  for (const { side, team, opp, goals } of sides) {
    for (const minute of randomMinutes(goals, from, to, rng)) {
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
      for (const minute of randomMinutes(samplePoisson(rate / 2, rng), from, to, rng)) {
        events.push({ minute, type, side, text: fillTeams(rng.pick(tpls), team.name, opp.name) });
      }
    }
    // Faltas: las comete el rival (`opp`) sobre este equipo; la tarjeta se la lleva uno de sus titulares de campo.
    for (const minute of randomMinutes(samplePoisson(MATCH.foulsPerTeam / 2, rng), from, to, rng)) {
      const r = rng.next();
      const card = r < MATCH.redCardShare ? 'red' : r < MATCH.redCardShare + MATCH.yellowCardShare ? 'yellow' : null;
      const tpls = card === 'red' ? COMMENT_RED : card === 'yellow' ? COMMENT_YELLOW : COMMENT_FOUL;
      // Simplificación: la roja no deja al equipo con uno menos, pero la tarjeta cuenta (suspensión).
      const culprit = card ? pickFouler(opp, rng) : null;
      events.push({
        minute, type: 'foul', side: side === 'home' ? 'away' : 'home', card,
        playerId: culprit?.id ?? null,
        text: fillTeams(rng.pick(tpls), team.name, culprit?.name ?? opp.name),
      });
    }
  }

  // Lesiones (HTML 687-706): solo titulares; la probabilidad de un partido se reparte en los 2 tiempos.
  for (const { side, team } of sides) {
    const level = opts.medicalLevel?.[side] ?? 0;
    for (const p of lineupPlayers(team)) {
      if (injured.has(p.id) || p.injury) continue;
      if (p.pos === 'POR' && availableGkCount(team, p.id) === 0) continue; // HTML 689
      let chance = p.pos === 'POR' ? INJURY.baseChanceGk : INJURY.baseChance;
      if (p.fatigue > INJURY.fatigueThreshold) chance *= INJURY.fatigueMult;
      chance *= p.injuryProneness;
      if (!rng.chance(1 - Math.sqrt(1 - Math.min(1, chance)))) continue;
      const injury = rollInjury(rng, level);
      events.push({
        minute: rng.int(from, to), type: 'injury', side, playerId: p.id, injury,
        text: `🚑 ${p.name} (${team.name}) sale lesionado: ${injury.type}.`,
      });
      injured.add(p.id);
    }
  }

  events.sort((a, b) => a.minute - b.minute);
  return { half, hg, ag, events, xg };
}

/** Une los dos tiempos en el partido completo; define por penales si es eliminatoria y hay empate. */
export function composeMatch(
  home: Team,
  away: Team,
  first: HalfResult,
  second: HalfResult,
  rng: Rng,
  opts: SimOptions = {},
): SimulatedMatch {
  const events = [...first.events, ...second.events].sort((a, b) => a.minute - b.minute);
  const hg = first.hg + second.hg;
  const ag = first.ag + second.ag;
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
  return {
    result,
    events,
    xg: { home: first.xg.home + second.xg.home, away: first.xg.away + second.xg.away },
  };
}

export function simulateMatch(home: Team, away: Team, rng: Rng, opts: SimOptions = {}): SimulatedMatch {
  const first = simulateHalf(home, away, rng, 1, opts);
  const second = simulateHalf(home, away, rng, 2, { ...opts, prior: first.events });
  return composeMatch(home, away, first, second, rng, opts);
}

function goalkeeper(team: Team): Player | undefined {
  return lineupPlayers(team).find((p) => p.pos === 'POR');
}

/**
 * Orden de pateadores (HTML 665-671, 3251-3280): primero los elegidos por el DT que estén en cancha,
 * en su orden; después los mejores de campo de la alineación (y el arquero al final).
 */
export function penaltyTakerOrder(team: Team): Player[] {
  const line = lineupPlayers(team);
  const chosen = team.penaltyTakers
    .map((id) => line.find((p) => p.id === id))
    .filter((p): p is Player => !!p)
    .slice(0, 5);
  const used = new Set(chosen.map((p) => p.id));
  const rest = line.filter((p) => !used.has(p.id) && p.pos !== 'POR').sort((a, b) => b.rating - a.rating);
  const gk = line.filter((p) => !used.has(p.id) && p.pos === 'POR');
  const all = [...chosen, ...rest, ...gk];
  return all.length ? all : line;
}

/** Tanda de 5 penales por lado y luego muerte súbita. Mismo procedimiento para todos los equipos. */
export function penaltyShootout(home: Team, away: Team, rng: Rng): { home: number; away: number } {
  const ht = penaltyTakerOrder(home), at = penaltyTakerOrder(away);
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
