// Competiciones: copa nacional, Copa Internacional, playoffs y Copa de Campeones; y el avance de un paso del calendario.
// Port de HTML 848-1083 (copas), 1157-1171, 1659-1880 (playoffs, Copa de Campeones).
// Las funciones que reciben GameState lo MUTAN (se llaman dentro de immer). Todo el azar sale del rng recibido.
//
// Diferencias con el original (que solo simula "en vivo" al usuario y por atajo al resto):
//  - Todos los partidos se juegan con el mismo motor (playFixture), no con quickSimScore.
//  - Cada paso del calendario juega TODAS las divisiones a la vez (el original resuelve los playoffs de otras divisiones
//    de una sola vez); la distribución de resultados es la misma.
//  - La Copa Internacional se arma para cualquier clasificado (campeón de los playoffs de A), no solo si es el usuario.
//  - No hay cancha neutral: el original define localía con decideHomeAway (HTML 883-893) incluso en las finales.
import type {
  CalendarStep, ChampionsCup, ChampionsHistoryEntry, CompetitionKey, Cup, DivisionId, GameState, IntlCup, IntlGroupId,
  IntlGroupRow, MatchResult, Team, TeamRef, Tie,
} from '../domain/types';
import { intlRoundLabel, playoffStageLabel } from './calendar';
import { COMPETITIONS, MARKET } from './config';
import { generateGuestTeam } from './generate';
import { playFixture } from './play';
import { computeSeasonObjective } from './objective';
import { createRng, shuffle, type Rng } from './rng';
import type { SimulatedMatch } from './match';
import { standings } from './standings';
import { teamStrength } from './strength';
import { allTeams, DIVISIONS, findTeam, pushNews, teamDivision } from './world';

const INTL_GROUPS: IntlGroupId[] = ['A', 'B', 'C'];

// ---------------------------------------------------------------------------------------------
// Utilidades de cruces
// ---------------------------------------------------------------------------------------------

/** Ganador de un cruce ya jugado (HTML 1159: m.hg>m.ag ? home : away, donde los penales suman un gol al ganador). */
export function tieWinner(t: Tie): string | null {
  const r = t.result;
  if (!r) return null;
  if (r.hg !== r.ag) return r.hg > r.ag ? t.home : t.away;
  if (r.penalties) return r.penalties.home > r.penalties.away ? t.home : t.away;
  return null;
}

export const tieLoser = (t: Tie): string | null => {
  const w = tieWinner(t);
  return w === null ? null : w === t.home ? t.away : t.home;
};

const allPlayed = (ties: Tie[]) => ties.every((t) => t.result !== null);

function ref(state: GameState, id: string | null): TeamRef | null {
  return id ? { id, name: findTeam(state, id)?.name ?? '?' } : null;
}

/**
 * Localía de un cruce (HTML 883-893): es local el de la división más baja; con la misma división, el de menos puntos,
 * y si empatan, el de peor diferencia de gol; si no, el primero.
 */
export function decideHomeAway(state: GameState, id1: string, id2: string): [string, string] {
  const rank = (id: string) => MARKET.divRank[teamDivision(state, id) ?? 'C'];
  if (rank(id1) !== rank(id2)) return rank(id1) < rank(id2) ? [id1, id2] : [id2, id1];
  const t1 = findTeam(state, id1), t2 = findTeam(state, id2);
  if (!t1 || !t2) return [id1, id2];
  if (t1.record.pts !== t2.record.pts) return t1.record.pts < t2.record.pts ? [id1, id2] : [id2, id1];
  const gd1 = t1.record.gf - t1.record.ga, gd2 = t2.record.gf - t2.record.ga;
  if (gd1 !== gd2) return gd1 < gd2 ? [id1, id2] : [id2, id1];
  return [id1, id2];
}

/** HTML 894-901. */
function pairWithHomeAway(state: GameState, ids: string[]): Tie[] {
  const ties: Tie[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    const [home, away] = decideHomeAway(state, ids[i], ids[i + 1]);
    ties.push({ home, away, result: null });
  }
  return ties;
}

/** HTML 1660. */
function pairConsecutive(ids: string[], label?: string): Tie[] {
  const ties: Tie[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) ties.push({ home: ids[i], away: ids[i + 1], result: null, ...(label ? { label } : {}) });
  return ties;
}

/** Suma un título al usuario y avisa (a todos: campeón de cada competición). */
function announceChampion(state: GameState, key: CompetitionKey, id: string, text: (name: string) => string, userText: string): void {
  const name = findTeam(state, id)?.name ?? '?';
  if (id === state.userTeamId) {
    state.titles.push({ season: state.season, competition: key });
    pushNews(state, userText);
  } else {
    pushNews(state, text(name));
  }
}

// ---------------------------------------------------------------------------------------------
// Copa nacional (HTML 848-938, 1157-1171)
// ---------------------------------------------------------------------------------------------

export function cupStageLabel(stage: number): string {
  return COMPETITIONS.cupStageLabels[stage] ?? `Ronda ${stage + 1}`;
}

/**
 * Sorteo de la primera ronda (HTML 902-912): 10 equipos de A con bye (los mejores de la temporada anterior; en la primera,
 * los más fuertes) y el resto sorteado a partido único.
 */
export function buildCup(state: GameState, rng: Rng): Cup {
  const ids = allTeams(state).map((t) => t.id);
  const n = COMPETITIONS.cupByes;
  const last = (state.lastSeasonAStandings ?? []).filter((id) => ids.includes(id)).slice(0, n);
  let byes: string[];
  if (state.season <= 1 || last.length < n) {
    byes = [...state.divisions.A.teams].sort((a, b) => teamStrength(b) - teamStrength(a)).slice(0, n).map((t) => t.id);
  } else {
    byes = last;
  }
  const rest = shuffle(ids.filter((id) => !byes.includes(id)), rng);
  if (rest.length % 2 === 1) byes = [...byes, rest.pop() as string]; // salvaguarda: con 54 equipos nunca pasa
  return { stage: 0, ties: pairWithHomeAway(state, rest), pendingByes: byes, rounds: [], champion: null };
}

/** HTML 1157-1171. Termina la ronda: pasan los ganadores (más los byes en la segunda) y se sortea la siguiente. */
function advanceCup(state: GameState, rng: Rng): void {
  const cup = state.cup;
  if (!cup) return;
  const winners = cup.ties.map((t) => tieWinner(t) as string);
  cup.rounds.push({ stage: cup.stage, ties: cup.ties });
  const next = cup.pendingByes ? [...winners, ...cup.pendingByes] : winners;
  cup.pendingByes = null;
  if (next.length <= 1) {
    cup.champion = next[0] ?? null;
    cup.ties = [];
    if (cup.champion) {
      announceChampion(state, 'copa', cup.champion, (n) => `🏆 ${n} ganó la Copa.`, '🏆 ¡Ganaste la Copa!');
    }
    return;
  }
  cup.ties = pairWithHomeAway(state, shuffle(next, rng));
  cup.stage++;
}

// ---------------------------------------------------------------------------------------------
// Copa Internacional (HTML 939-1083)
// ---------------------------------------------------------------------------------------------

/** Fechas de un grupo de 4 (HTML 941-951): cada equipo juega una vez contra los otros tres. */
function roundRobinRounds(ids: string[]): [string, string][][] {
  const arr = [...ids];
  const rounds: [string, string][][] = [];
  for (let r = 0; r < 3; r++) {
    rounds.push([[arr[0], arr[3]], [arr[1], arr[2]]]);
    const last = arr[3];
    for (let i = 3; i > 1; i--) arr[i] = arr[i - 1];
    arr[1] = last;
  }
  return rounds;
}

const emptyRow = (id: string): IntlGroupRow => ({ id, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });

/**
 * Arma la Copa Internacional (HTML 952-980): el clasificado (campeón de los playoffs de A) y 11 invitados generados,
 * 12 equipos sorteados en 3 grupos de 4. Reemplaza a los invitados de la temporada anterior.
 */
export function buildIntlCup(state: GameState, rng: Rng): void {
  const q = state.intlCupQualifiedNextSeason;
  state.intlGuestTeams = {};
  if (!q || !findTeam(state, q)) {
    state.intlCup = null;
    return;
  }
  const { names, guestCount, groupSize } = COMPETITIONS.intl;
  const guestIds: string[] = [];
  shuffle(names, rng).slice(0, guestCount).forEach((name, i) => {
    const t = generateGuestTeam(rng, name, i);
    state.intlGuestTeams[t.id] = t;
    guestIds.push(t.id);
  });
  const all = shuffle([q, ...guestIds], rng);
  const groups = {} as IntlCup['groups'];
  const groupSchedule = {} as IntlCup['groupSchedule'];
  INTL_GROUPS.forEach((g, gi) => {
    const ids = all.slice(gi * groupSize, (gi + 1) * groupSize);
    groups[g] = ids.map(emptyRow);
    groupSchedule[g] = roundRobinRounds(ids).map((round) => round.map(([home, away]): Tie => ({ home, away, result: null })));
  });
  state.intlCup = { stage: 'groups', groupRound: 0, groups, groupSchedule, ties: [], rounds: [], champion: null };
}

/** HTML 1000-1002: puntos, diferencia de gol, goles a favor. */
export function sortIntlGroup(rows: IntlGroupRow[]): IntlGroupRow[] {
  return [...rows].sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf);
}

function applyIntlGroupResult(ic: IntlCup, g: IntlGroupId, tie: Tie, hg: number, ag: number): void {
  const h = ic.groups[g].find((s) => s.id === tie.home), a = ic.groups[g].find((s) => s.id === tie.away);
  if (!h || !a) return;
  h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
  if (hg > ag) { h.w++; h.pts += 3; a.l++; }
  else if (hg < ag) { a.w++; a.pts += 3; h.l++; }
  else { h.d++; a.d++; h.pts++; a.pts++; }
}

/** HTML 1003-1016: pasan los 2 primeros de cada grupo y los 2 mejores terceros; los cuartos se sortean. */
function advanceIntlGroups(state: GameState, ic: IntlCup, rng: Rng): void {
  ic.groupRound++;
  if (ic.groupRound < 3) return;
  const sorted = Object.fromEntries(INTL_GROUPS.map((g) => [g, sortIntlGroup(ic.groups[g])])) as Record<IntlGroupId, IntlGroupRow[]>;
  const qualifiers = INTL_GROUPS.flatMap((g) => [sorted[g][0].id, sorted[g][1].id]);
  const thirds = sortIntlGroup(INTL_GROUPS.map((g) => sorted[g][2]));
  qualifiers.push(...thirds.slice(0, COMPETITIONS.intl.bestThirds).map((r) => r.id));
  ic.ties = pairConsecutive(shuffle(qualifiers, rng), 'Cuartos de final');
  ic.stage = 'QF';
  pushNews(state, '🌎 Se sortearon los cuartos de final de la Copa Internacional.');
}

/** HTML 1017-1033. */
function advanceIntlKnockout(state: GameState, ic: IntlCup, rng: Rng): void {
  if (ic.stage !== 'QF' && ic.stage !== 'SF' && ic.stage !== 'F') return;
  const winners = ic.ties.map((t) => tieWinner(t) as string);
  ic.rounds.push({ stage: ic.stage, ties: ic.ties });
  if (winners.length <= 1) {
    ic.champion = winners[0] ?? null;
    ic.stage = 'done';
    ic.ties = [];
    if (ic.champion) {
      announceChampion(state, 'intl', ic.champion, (n) => `🌎🏆 ${n} ganó la Copa Internacional.`, '🌎🏆 ¡Ganaste la Copa Internacional!');
    }
    return;
  }
  const label = winners.length === 2 ? 'Final' : 'Semifinal';
  ic.ties = pairConsecutive(shuffle(winners, rng), label);
  ic.stage = winners.length === 2 ? 'F' : 'SF';
}

// ---------------------------------------------------------------------------------------------
// Playoffs (HTML 1659-1728)
// ---------------------------------------------------------------------------------------------

/** Cruces de cuartos (HTML 1661-1664): 1º-8º, 4º-5º, 2º-7º, 3º-6º. */
function buildQFTies(quals: string[]): Tie[] {
  return pairConsecutive(COMPETITIONS.playoffBracket.map((i) => quals[i]));
}

/**
 * Cierra la fase regular de una división (HTML 1699-1728): B y C: el campeón asciende directo y del 2º al 9º juegan el
 * playoff por el segundo ascenso; A: los 8 primeros juegan por el título. Define también los descensos (A y B: 2; C: 3,
 * sin tocar al usuario si está entre los últimos, HTML 1713-1721).
 */
function buildPlayoff(state: GameState, div: DivisionId): void {
  const d = state.divisions[div];
  const table = standings(d.teams);
  const seeds = COMPETITIONS.playoffSeeds;
  let quals: string[];
  if (div !== 'A') {
    d.promotedDirect = table[0].id;
    quals = table.slice(1, 1 + seeds).map((t) => t.id);
    if (d.promotedDirect === state.userTeamId) {
      state.titles.push({ season: state.season, competition: div === 'B' ? 'divB' : 'divC' });
      pushNews(state, `🎉 ¡Campeón de Primera ${div}! Ascenso directo a Primera ${div === 'B' ? 'A' : 'B'}.`);
    }
  } else {
    quals = table.slice(0, seeds).map((t) => t.id);
  }
  d.playoff = { quals, stage: 'QF', ties: buildQFTies(quals), rounds: [], winner: null };
  const down = COMPETITIONS.relegations[div];
  if (div === 'C') {
    let bottom = table.slice(-down).map((t) => t.id);
    if (bottom.includes(state.userTeamId ?? '') && state.userDivision === 'C') {
      bottom = bottom.filter((id) => id !== state.userTeamId);
      for (let i = table.length - down - 1; i >= 0 && bottom.length < down; i--) {
        const cand = table[i].id;
        if (cand !== state.userTeamId && !bottom.includes(cand)) bottom.push(cand);
      }
    }
    d.relegated = bottom;
  } else {
    d.relegated = div === 'A' || div === 'B' ? table.slice(-down).map((t) => t.id) : null;
  }
  d.phase = 'playoffs';
}

/** HTML 1729-1739: cuando todas las divisiones terminaron la liga, se arman los playoffs. */
function finishRegularSeason(state: GameState): void {
  for (const div of DIVISIONS) {
    const d = state.divisions[div];
    if (d.phase === 'regular' && d.matchday >= d.schedule.length) buildPlayoff(state, div);
  }
}

/** HTML 1674-1687. */
function advancePlayoff(state: GameState, div: DivisionId): void {
  const p = state.divisions[div].playoff;
  if (!p || p.stage === 'done') return;
  const winners = p.ties.map((t) => tieWinner(t) as string);
  p.rounds.push({ stage: p.stage, ties: p.ties });
  if (winners.length === 1) {
    p.winner = winners[0];
    p.stage = 'done';
    p.ties = [];
    state.divisions[div].phase = 'done';
    const w = winners[0];
    if (div === 'A') {
      state.intlCupQualifiedNextSeason = w; // HTML 1949
      announceChampion(state, 'divA', w, (n) => `🏆 ${n} es el campeón de Primera A.`, '🏆 ¡Campeón de los playoffs de Primera A! Clasificás a la Copa Internacional.');
    } else {
      const up = div === 'B' ? 'A' : 'B';
      const name = findTeam(state, w)?.name ?? '?';
      pushNews(state, w === state.userTeamId ? `🎉 ¡Ganaste el playoff de ascenso a Primera ${up}!` : `⬆️ ${name} ganó el playoff de ascenso a Primera ${up}.`);
    }
    return;
  }
  p.stage = p.stage === 'QF' ? 'SF' : 'F';
  p.ties = pairConsecutive(winners);
}

// ---------------------------------------------------------------------------------------------
// Copa de Campeones (HTML 1741-1850)
// ---------------------------------------------------------------------------------------------

/** HTML 1750-1776: campeón de A, B y C y el de la copa (o el subcampeón de A si el campeón de copa ya está clasificado). */
function buildChampionsCup(state: GameState): void {
  const champA = state.divisions.A.playoff?.winner ?? null;
  const champB = state.divisions.B.promotedDirect;
  const champC = state.divisions.C.promotedDirect;
  if (!champA || !champB || !champC) return;
  const champCup = state.cup?.champion ?? null;
  let rep = champCup;
  if (!rep || rep === champA || rep === champB || rep === champC) {
    const final = state.divisions.A.playoff?.rounds.find((r) => r.stage === 'F');
    const runnerUp = final ? tieLoser(final.ties[0]) : null;
    if (runnerUp) rep = runnerUp;
  }
  if (!rep) return;
  const [h1, a1] = decideHomeAway(state, champA, champC);
  const [h2, a2] = decideHomeAway(state, champB, rep);
  state.championsCup = {
    stage: 'SF',
    ties: [
      { home: h1, away: a1, result: null, label: 'A vs C' },
      { home: h2, away: a2, result: null, label: 'B vs Copa' },
    ],
    rounds: [],
    champion: null,
    copaRepresentative: rep,
  };
}

/** HTML 1837-1850. */
function recordChampionsHistory(state: GameState, cc: ChampionsCup): void {
  const rep = cc.copaRepresentative ?? state.cup?.champion ?? null;
  const entry: ChampionsHistoryEntry = {
    season: state.season,
    champA: ref(state, state.divisions.A.playoff?.winner ?? null),
    champB: ref(state, state.divisions.B.promotedDirect),
    champC: ref(state, state.divisions.C.promotedDirect),
    champCup: ref(state, state.cup?.champion ?? null),
    champCupRep: rep !== (state.cup?.champion ?? null) ? ref(state, rep) : null,
    champChampionsCup: ref(state, cc.champion),
    champIntl: ref(state, state.intlCup?.champion ?? null),
  };
  state.championsHistory.push(entry);
  if (state.championsHistory.length > COMPETITIONS.historyMax) state.championsHistory.shift();
}

/** HTML 1786-1801. */
function advanceChampions(state: GameState): void {
  const cc = state.championsCup;
  if (!cc || cc.stage === 'done') return;
  const winners = cc.ties.map((t) => tieWinner(t) as string);
  cc.rounds.push({ stage: cc.stage, ties: cc.ties });
  if (winners.length === 1) {
    cc.champion = winners[0];
    cc.stage = 'done';
    cc.ties = [];
    recordChampionsHistory(state, cc);
    announceChampion(state, 'campeones', winners[0], (n) => `🏆🏆 ${n} ganó la Copa de Campeones.`, '🏆🏆 ¡Ganaste la Copa de Campeones!');
    return;
  }
  cc.stage = 'F';
  const [home, away] = decideHomeAway(state, winners[0], winners[1]);
  cc.ties = [{ home, away, result: null, label: 'Final' }];
}

// ---------------------------------------------------------------------------------------------
// Pasos del calendario
// ---------------------------------------------------------------------------------------------

/** Un partido por jugar dentro de un paso. */
export interface StepFixture {
  homeId: string;
  awayId: string;
  /** Eliminatoria (penales si hay empate). */
  knockout: boolean;
  /** Texto corto del partido: "Fecha 7", "Copa · Octavos de final". */
  label: string;
  /** Nombre de la competición y de la etapa, para las noticias de eliminación. */
  competition: string;
  stage: string;
  division?: DivisionId;
  group?: IntlGroupId;
  tie?: Tie;
}

/** Partidos pendientes del paso (solo lectura: se puede llamar al renderizar). */
export function stepFixtures(state: GameState, step: CalendarStep): StepFixture[] {
  const out: StepFixture[] = [];
  const fromTies = (ties: Tie[], base: Omit<StepFixture, 'homeId' | 'awayId' | 'tie'>) => {
    for (const tie of ties) if (!tie.result) out.push({ ...base, homeId: tie.home, awayId: tie.away, tie });
  };
  switch (step.kind) {
    case 'league':
      for (const d of DIVISIONS) {
        const div = state.divisions[d];
        if (div.phase !== 'regular') continue;
        for (const [homeId, awayId] of div.schedule[div.matchday] ?? []) {
          out.push({ homeId, awayId, knockout: false, label: `Fecha ${div.matchday + 1}`, competition: 'Liga', stage: `Fecha ${div.matchday + 1}`, division: d });
        }
      }
      break;
    case 'cup': {
      const cup = state.cup;
      if (!cup || cup.champion) break;
      const stage = cupStageLabel(cup.stage);
      fromTies(cup.ties, { knockout: true, label: `Copa · ${stage}`, competition: 'la Copa', stage });
      break;
    }
    case 'intl': {
      const ic = state.intlCup;
      if (!ic || ic.stage === 'done') break;
      if (ic.stage === 'groups') {
        const stage = intlRoundLabel(Math.min(ic.groupRound, 2));
        for (const g of INTL_GROUPS) {
          fromTies(ic.groupSchedule[g][ic.groupRound] ?? [], { knockout: false, label: `Copa Internacional · ${stage}`, competition: 'la Copa Internacional', stage, group: g });
        }
      } else {
        const stage = ic.stage === 'QF' ? 'Cuartos de final' : ic.stage === 'SF' ? 'Semifinal' : 'Final';
        fromTies(ic.ties, { knockout: true, label: `Copa Internacional · ${stage}`, competition: 'la Copa Internacional', stage });
      }
      break;
    }
    case 'playoff':
      for (const d of DIVISIONS) {
        const div = state.divisions[d];
        const p = div.playoff;
        if (div.phase !== 'playoffs' || !p || p.stage !== step.stage) continue;
        const stage = playoffStageLabel(step.stage);
        const comp = d === 'A' ? 'los playoffs de Primera A' : `el playoff de ascenso de Primera ${d}`;
        fromTies(p.ties, { knockout: true, label: `Playoffs ${d} · ${stage}`, competition: comp, stage, division: d });
      }
      break;
    case 'champions': {
      const cc = state.championsCup;
      if (!cc || cc.stage !== step.stage) break;
      const stage = step.stage === 'SF' ? 'Semifinal' : 'Final';
      fromTies(cc.ties, { knockout: true, label: `Copa de Campeones · ${stage}`, competition: 'la Copa de Campeones', stage });
      break;
    }
  }
  return out;
}

/** Partido del usuario en el paso, si lo hay. */
export function userStepFixture(state: GameState, step: CalendarStep): StepFixture | null {
  const me = state.userTeamId;
  if (!me) return null;
  return stepFixtures(state, step).find((f) => f.homeId === me || f.awayId === me) ?? null;
}

/**
 * Deja armado lo que falta, sin consumir azar salvo para sortear la copa: la copa de la temporada (partidas migradas o
 * recién creadas), los playoffs si la liga ya terminó y el objetivo del usuario. Es idempotente.
 */
export function ensureCompetitions(state: GameState): void {
  if (!state.cup && state.calendar.slice(state.calendarIndex).some((s) => s.kind === 'cup')) {
    const rng = createRng(state.rngState);
    state.cup = buildCup(state, rng);
    state.rngState = rng.state();
  }
  finishRegularSeason(state);
  // Objetivo de temporada (HTML 2064): se asigna al empezar; en partidas nuevas o migradas se completa acá.
  if (!state.objective && state.userTeamId) state.objective = computeSeasonObjective(state);
}

const slim = (r: MatchResult): NonNullable<Tie['result']> => ({
  hg: r.hg,
  ag: r.ag,
  ...(r.penalties ? { penalties: { home: r.penalties.home, away: r.penalties.away } } : {}),
});

/**
 * Juega un paso completo: todos sus partidos (con `userSim` para el del usuario si ya se vio en vivo) y avanza las
 * competiciones. No mueve `calendarIndex` (lo hace el llamador). Devuelve los resultados de liga del paso.
 */
export function runStep(state: GameState, step: CalendarStep, rng: Rng, userSim?: SimulatedMatch): MatchResult[] {
  const fixtures = stepFixtures(state, step);
  const league: Record<DivisionId, MatchResult[]> = { A: [], B: [], C: [] };
  const all: MatchResult[] = [];
  if (step.kind === 'league') state.preseasonWeeksLeft = 0; // jugar una fecha implica que la pretemporada terminó

  for (const fx of fixtures) {
    const home = findTeam(state, fx.homeId) as Team, away = findTeam(state, fx.awayId) as Team;
    const matchday = fx.division ? state.divisions[fx.division].matchday : 0;
    const r = playFixture(state, home, away, {
      rng,
      label: fx.label,
      knockout: fx.knockout,
      league: step.kind === 'league' && fx.division ? { division: fx.division, matchday } : null,
      userSim,
    });
    if (fx.tie) {
      fx.tie.result = slim(r);
      if (fx.group && state.intlCup) applyIntlGroupResult(state.intlCup, fx.group, fx.tie, r.hg, r.ag);
    }
    if (step.kind === 'league' && fx.division) league[fx.division].push(r);
    all.push(r);
    // Eliminación del usuario (HTML: el DT queda afuera de la competencia).
    const me = state.userTeamId;
    if (fx.knockout && fx.tie && me && (fx.homeId === me || fx.awayId === me) && tieWinner(fx.tie) !== me) {
      pushNews(state, `❌ Quedaste eliminado de ${fx.competition} en ${fx.stage.toLowerCase()}.`);
    }
  }

  switch (step.kind) {
    case 'league':
      for (const d of DIVISIONS) {
        const div = state.divisions[d];
        if (div.phase !== 'regular' || div.matchday >= div.schedule.length) continue;
        div.results.push(league[d]);
        div.matchday++;
      }
      finishRegularSeason(state);
      return all;
    case 'cup':
      if (state.cup && !state.cup.champion && allPlayed(state.cup.ties)) advanceCup(state, rng);
      break;
    case 'intl': {
      const ic = state.intlCup;
      if (!ic || ic.stage === 'done') break;
      if (ic.stage === 'groups') {
        if (INTL_GROUPS.every((g) => allPlayed(ic.groupSchedule[g][ic.groupRound] ?? []))) advanceIntlGroups(state, ic, rng);
      } else if (allPlayed(ic.ties)) advanceIntlKnockout(state, ic, rng);
      break;
    }
    case 'playoff':
      for (const d of DIVISIONS) {
        const p = state.divisions[d].playoff;
        if (state.divisions[d].phase === 'playoffs' && p && p.stage === step.stage && allPlayed(p.ties)) advancePlayoff(state, d);
      }
      if (DIVISIONS.every((d) => state.divisions[d].phase === 'done') && !state.championsCup) buildChampionsCup(state);
      break;
    case 'champions':
      if (state.championsCup && state.championsCup.stage === step.stage && allPlayed(state.championsCup.ties)) advanceChampions(state);
      break;
  }
  return [];
}

/** Cruces de un paso (jugados o por jugar) agrupados con un título, para mostrarlos. Vacío si todavía no existen. Solo lectura. */
export function stepTieGroups(state: GameState, step: CalendarStep): { title: string; ties: Tie[] }[] {
  switch (step.kind) {
    case 'league':
      return [];
    case 'cup': {
      const cup = state.cup;
      if (!cup) return [];
      const ties = cup.rounds.find((r) => r.stage === step.round)?.ties ?? (cup.stage === step.round ? cup.ties : []);
      return ties.length ? [{ title: cupStageLabel(step.round), ties }] : [];
    }
    case 'intl': {
      const ic = state.intlCup;
      if (!ic) return [];
      if (step.round < 3) return INTL_GROUPS.map((g) => ({ title: `Grupo ${g}`, ties: ic.groupSchedule[g][step.round] ?? [] }));
      const stage = step.round === 3 ? 'QF' : step.round === 4 ? 'SF' : 'F';
      const ties = ic.rounds.find((r) => r.stage === stage)?.ties ?? (ic.stage === stage ? ic.ties : []);
      return ties.length ? [{ title: intlRoundLabel(step.round), ties }] : [];
    }
    case 'playoff':
      return DIVISIONS.flatMap((d) => {
        const p = state.divisions[d].playoff;
        const ties = p?.rounds.find((r) => r.stage === step.stage)?.ties ?? (p?.stage === step.stage ? p.ties : []);
        return ties.length ? [{ title: `Primera ${d}`, ties }] : [];
      });
    case 'champions': {
      const cc = state.championsCup;
      const ties = cc?.rounds.find((r) => r.stage === step.stage)?.ties ?? (cc?.stage === step.stage ? cc.ties : []);
      return ties.length ? [{ title: step.stage === 'SF' ? 'Semifinales' : 'Final', ties }] : [];
    }
  }
}
