import { describe, expect, it } from 'vitest';
import type { GameState, MatchEvent, Team } from '../domain/types';
import { parseSave, CURRENT_SAVE_VERSION } from '../repo/saveSchema';
import { FATIGUE_BLOCK, SQUAD } from './config';
import { createNewGame } from './generate';
import { composeMatch, penaltyShootout, penaltyTakerOrder, simulateHalf, simulateMatch, type SimulatedMatch } from './match';
import { createRng } from './rng';
import { playMatchday, startNewSeason, userNextFixture, userTeam } from './season';
import {
  bestAvailableFive, firePlayer, isAvailable, lineupIssues, renewContract, renewCost, severanceCost, setPlayerNumber,
} from './squad';

function newGame(seed = 77): GameState {
  const s = createNewGame(seed, 'DT');
  s.userDivision = 'A';
  s.userTeamId = s.divisions.A.teams[0].id;
  return s;
}

/** Partido del usuario con eventos armados a mano (sin goles). */
function fakeUserSim(s: GameState, events: Omit<MatchEvent, 'side'>[]): SimulatedMatch {
  const fx = userNextFixture(s)!;
  const side = fx.home.id === s.userTeamId ? 'home' : 'away';
  return {
    result: { homeId: fx.home.id, awayId: fx.away.id, hg: 0, ag: 0, scorers: [] },
    events: events.map((e) => ({ ...e, side })),
    xg: { home: 1, away: 1 },
  };
}

const yellow = (playerId: string): Omit<MatchEvent, 'side'> => ({ minute: 5, type: 'foul', card: 'yellow', playerId, text: '' });

describe('tarjetas y suspensiones', () => {
  it('la 4ª amarilla suspende 1 partido, que se cumple recién en la fecha siguiente', () => {
    const s = newGame();
    const team = userTeam(s)!;
    const p = team.squad.find((x) => x.pos === 'CIE')!;
    p.yellowAccum = 3;
    playMatchday(s, fakeUserSim(s, [yellow(p.id)]));
    expect(p.stats.yellowCards).toBe(1);
    expect(p.yellowAccum).toBe(0);
    expect(p.suspension).toBe(1); // no se resta en la misma fecha en que se la ganó
    expect(s.news.some((n) => n.includes(p.name) && n.includes('amarillas'))).toBe(true);
    playMatchday(s);
    expect(p.suspension).toBe(0);
  });

  it('una amarilla sola solo acumula, y una roja suspende', () => {
    const s = newGame();
    const [a, b] = userTeam(s)!.squad.filter((x) => x.pos !== 'POR');
    playMatchday(s, fakeUserSim(s, [yellow(a.id), { minute: 9, type: 'foul', card: 'red', playerId: b.id, text: '' }]));
    expect(a.yellowAccum).toBe(1);
    expect(a.suspension).toBe(0);
    expect(b.stats.redCards).toBe(1);
    expect(b.suspension).toBe(1);
  });

  it('las faltas con tarjeta apuntan a un titular de campo del equipo infractor', () => {
    const s = newGame();
    const fx = userNextFixture(s)!;
    const rng = createRng(3);
    for (let i = 0; i < 100; i++) {
      const { events } = simulateMatch(fx.home, fx.away, rng);
      for (const e of events.filter((x) => x.type === 'foul' && x.card)) {
        const team = e.side === 'home' ? fx.home : fx.away;
        const p = team.squad.find((x) => x.id === e.playerId)!;
        expect(team.lineup).toContain(p.id);
        expect(p.pos).not.toBe('POR');
      }
    }
  });
});

describe('lesiones', () => {
  it('el evento de lesión se aplica al jugador y se recupera con las fechas', () => {
    const s = newGame();
    const p = userTeam(s)!.squad.find((x) => x.pos === 'ALA')!;
    playMatchday(s, fakeUserSim(s, [{ minute: 3, type: 'injury', playerId: p.id, injury: { type: 'fractura', matchesLeft: 2 }, text: '' }]));
    expect(p.injury).toEqual({ type: 'fractura', matchesLeft: 2 }); // la de este partido no se descuenta
    expect(s.news.some((n) => n.includes(p.name) && n.includes('lesion'))).toBe(true);
    playMatchday(s);
    expect(p.injury?.matchesLeft).toBe(1);
    playMatchday(s);
    expect(p.injury).toBeNull();
  });

  it('simulateHalf genera lesiones de titulares con minuto dentro del tiempo', () => {
    const s = newGame();
    const fx = userNextFixture(s)!;
    for (const t of [fx.home, fx.away]) t.squad.forEach((p) => (p.injuryProneness = 1.8));
    const rng = createRng(5);
    let found = 0;
    for (let i = 0; i < 400; i++) {
      const h = simulateHalf(fx.home, fx.away, rng, 2);
      for (const e of h.events.filter((x) => x.type === 'injury')) {
        found++;
        expect(e.minute).toBeGreaterThanOrEqual(21);
        expect(e.minute).toBeLessThanOrEqual(40);
        expect(e.injury!.matchesLeft).toBeGreaterThanOrEqual(1);
        const team = e.side === 'home' ? fx.home : fx.away;
        expect(team.lineup).toContain(e.playerId);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('disponibilidad y alineación', () => {
  it('lesionados, suspendidos y fatigados quedan fuera de bestAvailableFive', () => {
    const team = newGame().divisions.A.teams[1];
    const best = bestAvailableFive(team).filter(Boolean) as string[];
    const [a, b, c] = best.slice(1).map((id) => team.squad.find((p) => p.id === id)!);
    a.injury = { type: 'fractura', matchesLeft: 3 };
    b.suspension = 1;
    c.fatigue = FATIGUE_BLOCK;
    expect([a, b, c].some(isAvailable)).toBe(false);
    const after = bestAvailableFive(team);
    expect(after).toHaveLength(5);
    for (const x of [a, b, c]) expect(after).not.toContain(x.id);
    expect(after.every(Boolean)).toBe(true);
    expect(team.squad.find((p) => p.id === after[0])!.pos).toBe('POR');
  });

  it('la IA no alinea a sus no disponibles', () => {
    const s = newGame();
    const ai = s.divisions.A.teams[5];
    const starters = ai.lineup.filter(Boolean) as string[];
    const hurt = ai.squad.find((p) => p.id === starters[2])!;
    const banned = ai.squad.find((p) => p.id === starters[3])!;
    hurt.injury = { type: 'fractura', matchesLeft: 99 };
    banned.suspension = 99;
    playMatchday(s);
    expect(ai.lineup).not.toContain(hurt.id);
    expect(ai.lineup).not.toContain(banned.id);
    expect(ai.lineup.every(Boolean)).toBe(true);
  });

  it('lineupIssues detecta vacíos, no disponibles y falta de arquero', () => {
    const team = newGame().divisions.A.teams[2];
    expect(lineupIssues(team)).toEqual([]);
    const field = team.squad.find((p) => p.id === team.lineup[1])!;
    field.injury = { type: 'fractura', matchesLeft: 2 };
    team.lineup[2] = null;
    expect(lineupIssues(team)).toHaveLength(2);
    team.lineup = bestAvailableFive(team);
    expect(lineupIssues(team)).toEqual([]);
    const outfield = team.squad.find((p) => p.pos !== 'POR' && !team.lineup.includes(p.id))!;
    team.lineup[0] = outfield.id;
    expect(lineupIssues(team).some((i) => i.includes('arquero'))).toBe(true);
  });
});

describe('forma', () => {
  it('titulares suben con victoria (+1 extra al goleador), suplentes tienden a 0', () => {
    const s = newGame();
    const fx = userNextFixture(s)!;
    const mine = userTeam(s)!;
    const isHome = fx.home.id === mine.id;
    const scorer = mine.squad.find((p) => p.id === mine.lineup[4])!;
    const other = mine.squad.find((p) => p.id === mine.lineup[1])!;
    const sub = mine.squad.find((p) => !mine.lineup.includes(p.id))!;
    [scorer.form, other.form, sub.form] = [0, 0, 3];
    const sim = fakeUserSim(s, []);
    sim.result.hg = isHome ? 1 : 0;
    sim.result.ag = isHome ? 0 : 1;
    sim.result.scorers = [{ teamId: mine.id, playerId: scorer.id, minute: 4 }];
    playMatchday(s, sim);
    expect(scorer.form).toBe(2);
    expect(other.form).toBe(1);
    expect(sub.form).toBe(2);
  });
});

describe('contratos y plantel', () => {
  it('los contratos vencidos del usuario se van libres; la computadora renueva', () => {
    const s = newGame();
    const mine = userTeam(s)!;
    const leaving = mine.squad.filter((p) => p.pos !== 'POR').slice(0, 2);
    for (const p of mine.squad) p.contractYears = 3;
    for (const p of leaving) p.contractYears = 1;
    const ids = new Set(leaving.map((p) => p.id));
    const ai = s.divisions.A.teams[3];
    ai.squad.forEach((p) => (p.contractYears = 1));
    startNewSeason(s);
    const after = userTeam(s)!;
    expect(after.squad.some((p) => ids.has(p.id))).toBe(false);
    expect(after.squad.length).toBeGreaterThanOrEqual(SQUAD.minSeason);
    expect(after.squad.length).toBeLessThanOrEqual(SQUAD.max);
    expect(s.news.filter((n) => n.includes('se fue libre'))).toHaveLength(2);
    const aiAfter = s.divisions.A.teams.concat(s.divisions.B.teams).find((t) => t.id === ai.id)!;
    expect(aiAfter.squad.every((p) => p.contractYears > 0)).toBe(true);
  });

  it('renewContract: cobra el 25% del valor, suma 2-3 años y respeta el máximo y el presupuesto', () => {
    const team = newGame().divisions.A.teams[0];
    const p = team.squad[3];
    p.contractYears = 1;
    team.budget = 10_000_000;
    const cost = renewCost(p);
    expect(cost).toBe(Math.round((p.value * 0.25) / 100) * 100);
    const res = renewContract(team, p.id, createRng(1));
    expect(res.ok).toBe(true);
    expect(team.budget).toBe(10_000_000 - cost);
    expect(p.contractYears).toBeGreaterThanOrEqual(3);
    expect(p.contractYears).toBeLessThanOrEqual(4);
    p.contractYears = 4;
    renewContract(team, p.id, createRng(2));
    expect(p.contractYears).toBe(SQUAD.maxContractYears);
    expect(renewContract(team, p.id, createRng(3)).ok).toBe(false);
    p.contractYears = 1;
    team.budget = cost - 100;
    const broke = renewContract(team, p.id, createRng(4));
    expect(broke.ok).toBe(false);
    expect(p.contractYears).toBe(1);
  });

  it('firePlayer: cobra indemnización y no deja plantel < 6, ni sin arquero, ni sin plata', () => {
    const team = newGame().divisions.A.teams[0];
    team.budget = 10_000_000;
    const p = team.squad.find((x) => x.pos === 'CIE')!;
    const cost = severanceCost(p);
    expect(firePlayer(team, p.id)).toEqual({ ok: true, cost });
    expect(team.budget).toBe(10_000_000 - cost);
    expect(team.squad.some((x) => x.id === p.id)).toBe(false);
    expect(team.lineup).not.toContain(p.id);

    const gks = team.squad.filter((x) => x.pos === 'POR');
    expect(firePlayer(team, gks[0].id).ok).toBe(true);
    expect(firePlayer(team, gks[1].id).ok).toBe(false); // único arquero

    team.budget = 0;
    expect(firePlayer(team, team.squad.find((x) => x.pos === 'ALA')!.id).ok).toBe(false);

    team.budget = 10_000_000;
    team.squad = team.squad.slice(0, SQUAD.minAfterFire);
    expect(firePlayer(team, team.squad[team.squad.length - 1].id).ok).toBe(false);
  });

  it('setPlayerNumber exige 1..99 y único', () => {
    const team = newGame().divisions.A.teams[0];
    const [a, b] = team.squad;
    expect(setPlayerNumber(team, a.id, 0).ok).toBe(false);
    expect(setPlayerNumber(team, a.id, 100).ok).toBe(false);
    expect(setPlayerNumber(team, a.id, b.number).ok).toBe(false);
    const free = Array.from({ length: 99 }, (_, i) => i + 1).find((n) => !team.squad.some((p) => p.number === n))!;
    expect(setPlayerNumber(team, a.id, free).ok).toBe(true);
    expect(a.number).toBe(free);
  });
});

describe('penales con pateadores', () => {
  it('el orden usa penaltyTakers (solo los que están en cancha) y completa con los mejores', () => {
    const team: Team = newGame().divisions.A.teams[0];
    const field = team.lineup.slice(1).map((id) => team.squad.find((p) => p.id === id)!);
    const bench = team.squad.find((p) => !team.lineup.includes(p.id) && p.pos !== 'POR')!;
    const weakest = [...field].sort((a, b) => a.rating - b.rating)[0];
    team.penaltyTakers = [bench.id, weakest.id];
    const order = penaltyTakerOrder(team);
    expect(order[0].id).toBe(weakest.id); // el suplente no está en cancha: se ignora
    expect(order.map((p) => p.id)).not.toContain(bench.id);
    const rest = order.slice(1, 4).map((p) => p.rating);
    expect(rest).toEqual([...rest].sort((a, b) => b - a));
    team.penaltyTakers = [];
    expect(penaltyTakerOrder(team)[0].rating).toBe(Math.max(...field.map((p) => p.rating)));
  });


  it('la tanda con pateadores elegidos nunca termina empatada', () => {
    const s = newGame();
    const a = s.divisions.A.teams[0], b = s.divisions.A.teams[1];
    a.penaltyTakers = a.lineup.slice(1, 4).reverse() as string[];
    const rng = createRng(9);
    for (let i = 0; i < 300; i++) {
      const r = penaltyShootout(a, b, rng);
      expect(r.home).not.toBe(r.away);
    }
  });
});

describe('simulación por tiempos', () => {
  it('cada tiempo respeta su rango de minutos y la composición es determinista', () => {
    const s = newGame();
    const fx = userNextFixture(s)!;
    const h1 = simulateHalf(fx.home, fx.away, createRng(8), 1);
    expect(h1.events.every((e) => e.minute >= 1 && e.minute <= 20)).toBe(true);
    const rng = createRng(21);
    const first = simulateHalf(fx.home, fx.away, rng, 1);
    const second = simulateHalf(fx.home, fx.away, rng, 2, { prior: first.events });
    expect(second.events.every((e) => e.minute >= 21 && e.minute <= 40)).toBe(true);
    const composed = composeMatch(fx.home, fx.away, first, second, rng);
    const whole = simulateMatch(fx.home, fx.away, createRng(21));
    expect(composed).toEqual(whole);
    expect(composed.result.hg).toBe(first.hg + second.hg);
    expect(composed.events.filter((e) => e.type === 'goal' && e.side === 'home')).toHaveLength(composed.result.hg);
  });

  it('el 2º tiempo usa las tácticas actuales del equipo', () => {
    const s = newGame();
    const fx = userNextFixture(s)!;
    const base = simulateHalf(fx.home, fx.away, createRng(1), 2).xg;
    fx.home.tactic.formation = '4-0';
    fx.home.tactic.press = 'alta';
    const changed = simulateHalf(fx.home, fx.away, createRng(1), 2).xg;
    expect(changed.home).not.toBeCloseTo(base.home);
  });
});

describe('migración de guardado 1 → 2', () => {
  it('completa los campos nuevos y deja la partida cargable', () => {
    const s = createNewGame(5, 'DT');
    const raw = JSON.parse(JSON.stringify(s));
    raw.version = 1;
    for (const d of ['A', 'B', 'C']) {
      for (const t of raw.divisions[d].teams) {
        delete t.penaltyTakers;
        for (const p of t.squad) {
          delete p.injury;
          delete p.suspension;
          delete p.yellowAccum;
        }
      }
    }
    const loaded = parseSave(raw)!;
    expect(loaded).not.toBeNull();
    expect(loaded.version).toBe(CURRENT_SAVE_VERSION);
    expect(CURRENT_SAVE_VERSION).toBe(3);
    // lo de v3 (economía) se completa con defaults; el resto queda idéntico
    for (const d of ['A', 'B', 'C'] as const) {
      for (const [i, t] of loaded.divisions[d].teams.entries()) {
        expect(t.finance.ticketPrice).toBe(s.divisions[d].teams[i].finance.ticketPrice);
        expect(t.staff).toEqual(s.divisions[d].teams[i].staff);
        t.finance = s.divisions[d].teams[i].finance;
      }
    }
    expect(loaded).toEqual(s);
    // y se puede seguir jugando
    loaded.userDivision = 'A';
    loaded.userTeamId = loaded.divisions.A.teams[0].id;
    playMatchday(loaded);
    expect(loaded.divisions.A.matchday).toBe(1);
  });

  it('rechaza versiones futuras', () => {
    const raw = JSON.parse(JSON.stringify(createNewGame(5, 'DT')));
    raw.version = 99;
    expect(parseSave(raw)).toBeNull();
  });
});
