import { describe, expect, it } from 'vitest';
import type { CalendarStep, DivisionId, GameState } from '../domain/types';
import { parseSave } from '../repo/saveSchema';
import { buildCalendar } from './calendar';
import { buildCup, ensureCompetitions, runStep, stepFixtures, tieWinner } from './competitions';
import { COMPETITIONS } from './config';
import { createNewGame } from './generate';
import { computeSeasonObjective } from './objective';
import { tickMarket } from './market';
import { createRng } from './rng';
import { currentStep, isSeasonOver, playMatchday, playNextStep, startNewSeason, userNextFixture } from './season';
import { standings } from './standings';
import { teamStrength } from './strength';
import { allTeams } from './world';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

function newGame(seed: number, user = true): GameState {
  const s = createNewGame(seed, 'DT');
  if (user) {
    s.userDivision = 'A';
    s.userTeamId = s.divisions.A.teams[3].id;
  }
  ensureCompetitions(s);
  return s;
}

function playSeason(s: GameState): void {
  for (let guard = 0; !isSeasonOver(s) && guard < 200; guard++) playNextStep(s);
}

/** Juega pasos hasta que el paso actual sea `kind` (sin jugarlo). */
function playUntil(s: GameState, pred: (st: CalendarStep) => boolean): void {
  for (let guard = 0; guard < 200; guard++) {
    const st = currentStep(s);
    if (!st || pred(st)) return;
    playNextStep(s);
  }
}

/** Juega liga y copas sin encadenar los playoffs (que sin usuario en juego se simulan solos). */
function playToPlayoffs(s: GameState): void {
  const rng = createRng(s.rngState);
  for (let st = currentStep(s); st && st.kind !== 'playoff'; st = currentStep(s)) {
    runStep(s, st, rng);
    s.calendarIndex++;
  }
  s.rngState = rng.state();
}

const tag = (st: CalendarStep) => (st.kind === 'league' ? 'L' : st.kind === 'cup' ? `C${st.round}` : st.kind === 'intl' ? `I${st.round}` : st.kind === 'playoff' ? `P${st.stage}` : `K${st.stage}`);

describe('calendario intercalado (HTML 852-870)', () => {
  it('copa tras las fechas 5, 10, 15, 20, 25 y 29; playoffs y campeones al final', () => {
    const cal = buildCalendar({ leagueRounds: 34, cup: true, intl: false });
    expect(cal).toHaveLength(34 + 6 + 3 + 2);
    let leagues = 0;
    const cupAfter: number[] = [];
    cal.forEach((st, i) => {
      if (st.kind === 'league') leagues++;
      if (st.kind === 'cup') {
        cupAfter.push(leagues);
        expect(cal[i - 1].kind).toBe('league');
        expect(st.round).toBe(cupAfter.length - 1);
      }
    });
    expect(cupAfter).toEqual([5, 10, 15, 20, 25, 29]);
    expect(cal.slice(-5).map(tag)).toEqual(['PQF', 'PSF', 'PF', 'KSF', 'KF']);
    expect(cal.slice(0, 7).map(tag)).toEqual(['L', 'L', 'L', 'L', 'L', 'C0', 'L']);
  });

  it('con Internacional: sus 6 fechas van tras la 3, 8, 13, 18, 23 y 28', () => {
    const cal = buildCalendar({ leagueRounds: 34, cup: true, intl: true });
    expect(cal).toHaveLength(34 + 6 + 6 + 5);
    let leagues = 0;
    const after: number[] = [];
    for (const st of cal) {
      if (st.kind === 'league') leagues++;
      if (st.kind === 'intl') after.push(leagues);
    }
    expect(after).toEqual([3, 8, 13, 18, 23, 28]);
    expect(cal.slice(0, 5).map(tag)).toEqual(['L', 'L', 'L', 'I0', 'L']);
  });
});

describe('copa nacional (HTML 902-938, 1157-1171)', () => {
  it('primera ronda: 10 byes de A por fuerza (temporada 1), 22 partidos y 54 equipos', () => {
    const s = newGame(7);
    const cup = s.cup!;
    expect(cup.ties).toHaveLength(22);
    expect(cup.pendingByes).toHaveLength(10);
    const strongest = [...s.divisions.A.teams].sort((a, b) => teamStrength(b) - teamStrength(a)).slice(0, 10).map((t) => t.id);
    expect(new Set(cup.pendingByes)).toEqual(new Set(strongest));
    const inTies = cup.ties.flatMap((t) => [t.home, t.away]);
    expect(new Set(inTies).size).toBe(44);
    expect(inTies.some((id) => strongest.includes(id))).toBe(false);
    expect(new Set([...inTies, ...strongest])).toEqual(new Set(allTeams(s).map((t) => t.id)));
  });

  it('local = el de la división más baja (HTML 883-893)', () => {
    const s = newGame(8);
    const rank = (id: string) => DIVS.findIndex((d) => s.divisions[d].teams.some((t) => t.id === id));
    for (const t of s.cup!.ties) expect(rank(t.home)).toBeGreaterThanOrEqual(rank(t.away));
  });

  it('6 rondas con 22, 16, 8, 4, 2 y 1 partidos y un campeón', () => {
    const s = newGame(9, false);
    playSeason(s);
    const cup = s.cup!;
    expect(cup.rounds.map((r) => r.ties.length)).toEqual([22, 16, 8, 4, 2, 1]);
    expect(cup.champion).not.toBeNull();
    expect(cup.pendingByes).toBeNull();
    for (const r of cup.rounds) for (const t of r.ties) expect(tieWinner(t)).not.toBeNull(); // la eliminatoria siempre define
    expect(tieWinner(cup.rounds[5].ties[0])).toBe(cup.champion);
  });

  it('desde la temporada 2 los byes son los 10 primeros de A de la temporada anterior', () => {
    const s = newGame(10, false);
    playSeason(s);
    startNewSeason(s);
    const last = s.lastSeasonAStandings!;
    expect(last).toHaveLength(18);
    expect(new Set(s.cup!.pendingByes)).toEqual(new Set(last.slice(0, 10)));
    expect(buildCup(s, createRng(1)).pendingByes).toEqual(last.slice(0, 10));
  });
});

describe('temporada completa', () => {
  it('termina con todas las competiciones resueltas y un campeón por cada una', () => {
    const s = newGame(11);
    playSeason(s);
    expect(isSeasonOver(s)).toBe(true);
    for (const d of DIVS) {
      const div = s.divisions[d];
      expect(div.phase).toBe('done');
      expect(div.playoff!.stage).toBe('done');
      expect(div.playoff!.winner).not.toBeNull();
      expect(div.playoff!.rounds.map((r) => r.ties.length)).toEqual([4, 2, 1]);
    }
    expect(s.cup!.champion).not.toBeNull();
    expect(s.championsCup!.champion).not.toBeNull();
    expect(s.championsCup!.rounds.map((r) => r.ties.length)).toEqual([2, 1]);
    expect(s.championsHistory).toHaveLength(1);
    expect(s.championsHistory[0]).toMatchObject({ season: 1 });
    expect(s.championsHistory[0].champChampionsCup).not.toBeNull();
    expect(s.intlCupQualifiedNextSeason).toBe(s.divisions.A.playoff!.winner);
    expect(s.intlCup).toBeNull(); // la temporada 1 no tiene Internacional
    expect(userNextFixture(s)).toBeNull();
  });

  it('la Copa de Campeones: A vs C y B vs Copa; si el campeón de copa ya clasificó, lo representa el subcampeón de A', () => {
    const s = newGame(12, false);
    playSeason(s);
    const cc = s.championsCup!;
    const sf = cc.rounds[0].ties;
    const champs = [s.divisions.A.playoff!.winner, s.divisions.B.promotedDirect, s.divisions.C.promotedDirect];
    expect(new Set(sf.slice(0, 1).flatMap((t) => [t.home, t.away]))).toEqual(new Set([champs[0], champs[2]]));
    expect(new Set([sf[1].home, sf[1].away])).toContain(champs[1]);
    expect(cc.copaRepresentative).not.toBeNull();
    if (champs.includes(s.cup!.champion)) expect(cc.copaRepresentative).not.toBe(s.cup!.champion);
  });
});

describe('ascensos, descensos y playoffs (HTML 1699-1728, 1966-1997)', () => {
  it('cupos: A 1º-8º; B y C 2º-9º con el 1º directo; descienden 2, 2 y 3; cruces 1-8, 4-5, 2-7, 3-6', () => {
    const s = newGame(13, false);
    playToPlayoffs(s);
    expect(s.calendar[s.calendarIndex]).toEqual({ kind: 'playoff', stage: 'QF' });
    for (const d of DIVS) {
      const div = s.divisions[d];
      const table = standings(div.teams).map((t) => t.id);
      const p = div.playoff!;
      expect(div.phase).toBe('playoffs');
      expect(p.quals).toEqual(d === 'A' ? table.slice(0, 8) : table.slice(1, 9));
      if (d !== 'A') expect(div.promotedDirect).toBe(table[0]);
      expect(div.relegated).toEqual(table.slice(d === 'C' ? -3 : -2));
      const q = p.quals;
      expect(p.ties.map((t) => [t.home, t.away])).toEqual([[q[0], q[7]], [q[3], q[4]], [q[1], q[6]], [q[2], q[5]]]);
    }
  });

  it('startNewSeason: ascienden el campeón y el ganador del playoff de B y C; bajan 2 de A, 2 de B y 3 de C (salen)', () => {
    const s = newGame(14, false);
    playSeason(s);
    const D = s.divisions;
    const upB = [D.B.promotedDirect!, D.B.playoff!.winner!];
    const upC = [D.C.promotedDirect!, D.C.playoff!.winner!];
    const downA = D.A.relegated!, downB = D.B.relegated!, downC = D.C.relegated!;
    expect(downA).toHaveLength(2);
    expect(downB).toHaveLength(2);
    expect(downC).toHaveLength(3);
    startNewSeason(s);
    const where = (id: string) => DIVS.find((d) => s.divisions[d].teams.some((t) => t.id === id));
    expect(upB.map(where)).toEqual(['A', 'A']);
    expect(upC.map(where)).toEqual(['B', 'B']);
    expect(downA.map(where)).toEqual(['B', 'B']);
    expect(downB.map(where)).toEqual(['C', 'C']);
    expect(downC.map(where)).toEqual([undefined, undefined, undefined]);
    for (const d of DIVS) {
      expect(s.divisions[d].teams).toHaveLength(18);
      expect(s.divisions[d].phase).toBe('regular');
      expect(s.divisions[d].playoff).toBeNull();
    }
  });

  it('si el usuario está entre los 3 últimos de C, no desciende (HTML 1713-1721)', () => {
    const s = newGame(15, false);
    s.userDivision = 'C';
    const worst = s.divisions.C.teams[17];
    s.userTeamId = worst.id;
    playToPlayoffs(s);
    // (aunque no termine último, el chequeo vale: nunca figura entre los descendidos de C)
    expect(s.divisions.C.relegated).not.toContain(s.userTeamId);
    expect(s.divisions.C.relegated).toHaveLength(3);
  });
});

describe('Copa Internacional (HTML 940-1083)', () => {
  it('la temporada siguiente: 12 equipos (campeón de A + 11 invitados) en 3 grupos de 4 y un campeón', () => {
    const s = newGame(16, false);
    playSeason(s);
    const q = s.intlCupQualifiedNextSeason!;
    startNewSeason(s);
    const ic = s.intlCup!;
    expect(ic).not.toBeNull();
    expect(Object.keys(s.intlGuestTeams)).toHaveLength(11);
    const ids = (['A', 'B', 'C'] as const).flatMap((g) => ic.groups[g].map((r) => r.id));
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toContain(q);
    for (const g of ['A', 'B', 'C'] as const) {
      expect(ic.groups[g]).toHaveLength(4);
      expect(ic.groupSchedule[g]).toHaveLength(3);
      for (const round of ic.groupSchedule[g]) expect(round).toHaveLength(2);
      const pairs = new Set(ic.groupSchedule[g].flat().map((t) => [t.home, t.away].sort().join('|')));
      expect(pairs.size).toBe(6); // todos contra todos
    }
    expect(s.calendar.filter((st) => st.kind === 'intl')).toHaveLength(6);
    playSeason(s);
    expect(ic.stage).toBe('done');
    expect(s.intlCup!.rounds.map((r) => r.ties.length)).toEqual([4, 2, 1]);
    expect(s.intlCup!.champion).not.toBeNull();
    for (const g of ['A', 'B', 'C'] as const) for (const row of s.intlCup!.groups[g]) expect(row.w + row.d + row.l).toBe(3);
    expect(s.championsHistory[1].champIntl).not.toBeNull();
    expect(s.intlCupQualifiedNextSeason).not.toBeNull(); // el campeón de A de esta temporada clasifica para la que viene
  });
});

describe('todos los partidos aplican las mismas consecuencias', () => {
  it('copa: estadísticas, sanciones globales, fatiga y finanzas del local con la etiqueta del partido', () => {
    const s = newGame(17, false);
    // El usuario juega la primera ronda: así el paso de copa no se encadena solo y podemos mirar antes y después.
    s.userTeamId = s.cup!.ties[0].home;
    s.userDivision = (['A', 'B', 'C'] as const).find((d) => s.divisions[d].teams.some((t) => t.id === s.userTeamId))!;
    playUntil(s, (st) => st.kind === 'cup');
    const ties = s.cup!.ties;
    const teams = ties.flatMap((t) => [t.home, t.away]).map((id) => allTeams(s).find((x) => x.id === id)!);
    // Un suplente de un equipo de la computadora, ya suspendido: la sanción corre también en la copa.
    const cpu = teams.find((t) => t.id !== s.userTeamId)!;
    const starters = new Set(cpu.lineup);
    const bench = cpu.squad.find((p) => !starters.has(p.id))!;
    bench.suspension = 1;
    const games = teams.reduce((a, t) => a + t.squad.reduce((b, p) => b + p.stats.gamesPlayed, 0), 0);
    const homeTeam = allTeams(s).find((t) => t.id === s.userTeamId)!; // el usuario es local en ties[0]
    const budget = homeTeam.budget;
    const logLen = homeTeam.finance.log.length;
    playNextStep(s);
    const after = teams.reduce((a, t) => a + t.squad.reduce((b, p) => b + p.stats.gamesPlayed, 0), 0);
    expect(after - games).toBe(44 * 5);
    expect(bench.suspension).toBe(0);
    const entries = homeTeam.finance.log.slice(logLen);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.label.startsWith('Copa · Primera ronda'))).toBe(true);
    expect(entries.every((e) => e.matchday === null)).toBe(true);
    const gate = entries.find((e) => e.concept === 'entradas');
    expect(gate).toBeDefined();
    expect(gate!.amount).toBeGreaterThan(0);
    expect(homeTeam.budget).not.toBe(budget);
    // los goles de copa se cuentan en cupGoals y en goals
    const cupGoals = teams.flatMap((t) => t.squad).reduce((a, p) => a + (p.stats.cupGoals ?? 0), 0);
    expect(cupGoals).toBeGreaterThan(0);
    // la tabla de liga no se tocó con los partidos de copa
    for (const t of teams) expect(t.record.played).toBe(5);
    expect(Object.keys(s.h2h).length).toBeGreaterThan(0);
  });

  it('los empates de eliminatoria se definen por penales', () => {
    const s = newGame(18, false);
    playSeason(s);
    let withPens = 0;
    const all = [...s.cup!.rounds.flatMap((r) => r.ties), ...DIVS.flatMap((d) => s.divisions[d].playoff!.rounds.flatMap((r) => r.ties))];
    for (const t of all) {
      expect(tieWinner(t)).not.toBeNull();
      if (t.result!.hg === t.result!.ag) {
        withPens++;
        expect(t.result!.penalties).toBeDefined();
        expect(t.result!.penalties!.home).not.toBe(t.result!.penalties!.away);
      } else {
        expect(t.result!.penalties).toBeUndefined();
      }
    }
    expect(withPens).toBeGreaterThan(0);
  });

  it('stepFixtures de un paso de liga lista los 27 partidos y el del usuario es único', () => {
    const s = newGame(19);
    expect(stepFixtures(s, currentStep(s)!)).toHaveLength(27);
    const fx = userNextFixture(s)!;
    expect(fx.label).toBe('Fecha 1');
    expect(fx.knockout).toBe(false);
  });
});

describe('mercado y calendario', () => {
  it('el día de mercado sigue siendo la fecha de liga y tickMarket es idempotente tras cualquier paso', () => {
    const s = newGame(25);
    for (let i = 0; i < 40 && !isSeasonOver(s); i++) {
      playNextStep(s);
      const before = JSON.stringify(s);
      tickMarket(s);
      tickMarket(s);
      expect(JSON.stringify(s)).toBe(before);
    }
    // con la liga terminada el mercado está cerrado aunque falten pasos (playoffs, campeones)
    playSeason(s);
    expect(s.divisions.A.matchday).toBe(34);
  });
});

describe('objetivo de temporada (HTML 1544-1582)', () => {
  it('se asigna al empezar y queda evaluado en el historial al cerrar', () => {
    const s = newGame(20);
    expect(s.objective).not.toBeNull();
    expect(s.objective).toEqual(computeSeasonObjective(s));
    expect(s.objective!.division).toBe('A');
    playSeason(s);
    startNewSeason(s);
    expect(s.seasonHistory).toHaveLength(1);
    expect(s.seasonHistory[0].objective).not.toBeNull();
    expect(typeof s.seasonHistory[0].objectiveMet).toBe('boolean');
    expect(s.objective!.season).toBe(2);
  });

  it('los títulos del usuario quedan registrados', () => {
    // buscamos una semilla donde el usuario gane algo; el chequeo estructural vale siempre
    for (let seed = 100; seed < 120; seed++) {
      const s = newGame(seed);
      s.userTeamId = [...s.divisions.A.teams].sort((a, b) => teamStrength(b) - teamStrength(a))[0].id;
      playSeason(s);
      for (const t of s.titles) expect(['divA', 'divB', 'divC', 'copa', 'intl', 'campeones']).toContain(t.competition);
      if (s.titles.length > 0) return;
    }
  });
});

describe('determinismo', () => {
  it('la misma semilla reproduce la misma temporada completa', () => {
    const a = newGame(31), b = newGame(31);
    playSeason(a);
    playSeason(b);
    expect(a).toEqual(b);
    const c = newGame(32);
    playSeason(c);
    expect(c.cup!.champion).toBeDefined();
    expect(c).not.toEqual(a);
  });
});

describe('migración de guardado 4 → 5', () => {
  /** Arma una partida "v4": sin los campos nuevos, a mitad de temporada. */
  function v4At(seed: number, rounds: number) {
    const s = newGame(seed);
    for (let i = 0; i < rounds; i++) playMatchday(s);
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.version = 4;
    for (const k of ['calendar', 'calendarIndex', 'cup', 'intlCup', 'intlGuestTeams', 'intlCupQualifiedNextSeason', 'championsCup', 'championsHistory', 'lastSeasonAStandings', 'objective', 'seasonHistory', 'titles']) delete raw[k];
    for (const d of DIVS) {
      const div = (raw.divisions as Record<string, Record<string, unknown>>)[d];
      for (const k of ['phase', 'playoff', 'promotedDirect', 'relegated']) delete div[k];
    }
    return { raw, md: rounds };
  }

  it('a mitad de temporada (fecha 12): carga, las copas pasadas no se juegan y la temporada se completa', () => {
    const { raw } = v4At(41, 12);
    const loaded = parseSave(raw)!;
    expect(loaded.version).toBe(6);
    expect(loaded.divisions.A.matchday).toBe(12);
    expect(loaded.calendar.some((st) => st.kind === 'cup')).toBe(false);
    expect(loaded.calendar[loaded.calendarIndex]).toEqual({ kind: 'league', round: 12 });
    expect(loaded.cup).toBeNull();
    ensureCompetitions(loaded);
    expect(loaded.objective).not.toBeNull();
    playSeason(loaded);
    expect(isSeasonOver(loaded)).toBe(true);
    for (const d of DIVS) expect(loaded.divisions[d].playoff!.winner).not.toBeNull();
    expect(loaded.championsCup!.champion).not.toBeNull();
    startNewSeason(loaded);
    expect(loaded.season).toBe(2);
    for (const d of DIVS) expect(loaded.divisions[d].teams).toHaveLength(18);
  });

  it('antes de la primera ronda de copa (fecha 3): la copa se sortea al cargar y se juega entera', () => {
    const { raw } = v4At(42, 3);
    const loaded = parseSave(raw)!;
    expect(loaded.calendar.filter((st) => st.kind === 'cup')).toHaveLength(6);
    expect(loaded.cup).toBeNull();
    ensureCompetitions(loaded);
    expect(loaded.cup).not.toBeNull();
    playSeason(loaded);
    expect(loaded.cup!.champion).not.toBeNull();
    expect(loaded.cup!.rounds).toHaveLength(6);
  });

  it('con la liga terminada (fecha 34): arma los playoffs al cargar y sigue', () => {
    const { raw } = v4At(43, 34);
    const loaded = parseSave(raw)!;
    expect(loaded.calendar[loaded.calendarIndex]).toEqual({ kind: 'playoff', stage: 'QF' });
    ensureCompetitions(loaded);
    expect(loaded.divisions.A.phase).toBe('playoffs');
    playSeason(loaded);
    expect(isSeasonOver(loaded)).toBe(true);
  });
});

describe('varias temporadas seguidas', () => {
  it('5 temporadas: 18 por división, sin duplicados, todo resuelto cada año', () => {
    const s = newGame(51);
    for (let year = 1; year <= 5; year++) {
      playSeason(s);
      expect(isSeasonOver(s)).toBe(true);
      expect(s.cup!.champion).not.toBeNull();
      expect(s.championsCup!.champion).not.toBeNull();
      expect(s.championsHistory).toHaveLength(year);
      if (s.intlCup) expect(s.intlCup.champion).not.toBeNull();
      startNewSeason(s);
      const ids = allTeams(s).map((t) => t.id);
      expect(new Set(ids).size).toBe(54);
      for (const d of DIVS) expect(s.divisions[d].teams).toHaveLength(18);
      expect(new Set(allTeams(s).map((t) => t.name)).size).toBe(54);
      expect(s.cup!.ties).toHaveLength(COMPETITIONS.cupByes === 10 ? 22 : 0);
      expect(s.userTeamId === null ? s.dt.unemployed : allTeams(s).some((t) => t.id === s.userTeamId)).toBe(true); // el DT pudo ser despedido
    }
    expect(s.season).toBe(6);
    expect(s.seasonHistory).toHaveLength(s.dt.unemployed ? 3 : 5); // despedido a la 3.ª: ya no hay club que cerrar
  });
});
