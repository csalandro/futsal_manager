import { describe, expect, it } from 'vitest';
import type { DivisionId, GameState, Player, Team } from '../domain/types';
import { CURRENT_SAVE_VERSION, migrateV3toV4, parseSave } from '../repo/saveSchema';
import { ECONOMY, MARKET, RIVALRY, SQUAD } from './config';
import { computeAttendance } from './finance';
import { createNewGame } from './generate';
import {
  acceptOffer, advancePreseason, buyBlocker, buyPlayer, clubPrice, freeAgentPrice, isTransferWindowOpen, isWatched, marketWindow,
  scoutedPotential, tickMarket, toggleTransferListed, toggleWatch,
} from './market';
import { createRng } from './rng';
import { getUserRivalId, h2hFor, isRivalMatch, recordH2H } from './rivalry';
import { allTeams, isSeasonOver, playMatchday, startNewSeason, userTeam } from './season';
import { sellBlocker } from './squad';
import { teamStrength } from './strength';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

function newGame(seed = 11, div: DivisionId = 'A'): GameState {
  const s = createNewGame(seed, 'DT');
  s.userDivision = div;
  s.userTeamId = s.divisions[div].teams[0].id;
  tickMarket(s);
  return s;
}

/** Fuerza el reloj del mercado a un día de liga (sin jugar). */
function setDay(s: GameState, day: number): void {
  s.preseasonWeeksLeft = 0;
  for (const d of DIVS) s.divisions[d].matchday = day - 1;
}

/** Un rngState cuya primera tirada cumple el predicado (para forzar aceptación o rechazo de un fichaje). */
function rngWhere(pred: (x: number) => boolean): number {
  for (let st = 1; st < 10000; st++) if (pred(createRng(st).next())) return st;
  throw new Error('sin estado');
}

function otherClub(s: GameState, div: DivisionId): Team {
  return s.divisions[div].teams.find((t) => t.id !== s.userTeamId && t.squad.length > 8)!;
}

const outfield = (t: Team): Player => t.squad.filter((p) => p.pos !== 'POR').sort((a, b) => b.rating - a.rating)[0];
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('ventanas y pretemporada', () => {
  it('una partida nueva empieza en pretemporada con el mercado abierto', () => {
    const s = createNewGame(1, 'DT');
    expect(s.preseasonWeeksLeft).toBe(MARKET.preseasonWeeks);
    expect(isTransferWindowOpen(s)).toBe(true);
    expect(marketWindow(s).preseason).toBe(true);
  });

  it('las ventanas son los días 1-3 y 16-19 (día = matchday + 1) y informan cuándo abre la próxima', () => {
    const s = newGame();
    const check = (day: number, open: boolean, next: number | null) => {
      setDay(s, day);
      const w = marketWindow(s);
      expect([day, w.open, w.nextOpenDay]).toEqual([day, open, next]);
      expect(isTransferWindowOpen(s)).toBe(open);
    };
    check(1, true, null);
    check(3, true, null);
    check(4, false, 16);
    check(15, false, 16);
    check(16, true, null);
    check(19, true, null);
    check(20, false, null);
    check(34, false, null);
    s.divisions.A.matchday = 34; // temporada terminada
    expect(isTransferWindowOpen(s)).toBe(false);
  });

  it('advancePreseason resta semanas; jugar una fecha termina la pretemporada; la nueva temporada la reinicia', () => {
    const s = newGame();
    advancePreseason(s);
    expect(s.preseasonWeeksLeft).toBe(1);
    advancePreseason(s);
    advancePreseason(s);
    expect(s.preseasonWeeksLeft).toBe(0);
    expect(s.divisions.A.matchday).toBe(0); // sin partidos
    const t = createNewGame(2, 'DT');
    playMatchday(t);
    expect(t.preseasonWeeksLeft).toBe(0);
    while (!isSeasonOver(t)) playMatchday(t);
    startNewSeason(t);
    expect(t.preseasonWeeksLeft).toBe(MARKET.preseasonWeeks);
    expect(isTransferWindowOpen(t)).toBe(true);
  });

  it('con la ventana cerrada vencen las ofertas y las listas', () => {
    const s = newGame();
    expect(s.market.clubListings.length).toBeGreaterThan(0);
    setDay(s, 10);
    tickMarket(s);
    expect(s.market.clubListings).toEqual([]);
    expect(s.market.offers).toEqual([]);
  });

  it('los agentes libres se renuevan por ventana, no por fecha', () => {
    const s = newGame();
    const ids = s.market.freeAgents.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(MARKET.freeAgentCount);
    setDay(s, 2);
    tickMarket(s);
    expect(s.market.freeAgentsWindow).toBe(`early-${s.season}`);
    expect(s.market.freeAgents.every((p) => ids.includes(p.id))).toBe(true); // la computadora se llevó, como mucho, algunos
    expect(ids.length - s.market.freeAgents.length).toBeLessThanOrEqual(MARKET.ai.poolPicksPerEvent);
    setDay(s, 16);
    tickMarket(s);
    expect(s.market.freeAgentsWindow).toBe(`mid-${s.season}`);
    expect(s.market.freeAgents.map((p) => p.id)).not.toEqual(ids);
  });
});

describe('compra', () => {
  it('a un club: precio 1,15 × valor, sale del vendedor, le paga, entra con número libre y contrato', () => {
    const s = newGame(11, 'A');
    const me = userTeam(s)!;
    const club = otherClub(s, 'A');
    const p = outfield(club);
    club.lineup = club.lineup.map((id) => id);
    me.budget = 1_000_000;
    me.squad = me.squad.slice(0, 10);
    // que el número del jugador esté ocupado en el plantel del usuario
    me.squad[0].number = p.number;
    const price = Math.round((p.value * 1.15) / 100) * 100;
    expect(clubPrice(p)).toBe(price);
    const clubBudget = club.budget, myBudget = me.budget, n = me.squad.length;
    s.rngState = rngWhere((x) => x < 0.9);
    const res = buyPlayer(s, p.id);
    expect(res.ok).toBe(true);
    expect(me.budget).toBe(myBudget - price);
    expect(club.budget).toBe(clubBudget + price);
    expect(club.squad.some((x) => x.id === p.id)).toBe(false);
    expect(club.lineup).not.toContain(p.id);
    expect(me.squad).toHaveLength(n + 1);
    const bought = me.squad.find((x) => x.id === p.id)!;
    expect(new Set(me.squad.map((x) => x.number)).size).toBe(me.squad.length);
    expect(bought.contractYears).toBeGreaterThanOrEqual(2);
    expect(bought.contractYears).toBeLessThanOrEqual(4);
    expect(me.finance.log.some((e) => e.concept === 'fichajes' && e.amount === -price)).toBe(true);
    expect(club.finance.log.some((e) => e.concept === 'ventas' && e.amount === price)).toBe(true);
  });

  it('a un agente libre: cuesta su valor y sale de la lista', () => {
    const s = newGame(12, 'A');
    const me = userTeam(s)!;
    me.budget = 1_000_000;
    me.squad = me.squad.slice(0, 10);
    const p = s.market.freeAgents[0];
    const price = freeAgentPrice(p);
    expect(price).toBe(p.value);
    s.rngState = rngWhere((x) => x < 0.9);
    const before = me.budget;
    expect(buyPlayer(s, p.id).ok).toBe(true);
    expect(me.budget).toBe(before - price);
    expect(s.market.freeAgents.some((x) => x.id === p.id)).toBe(false);
    expect(me.squad.some((x) => x.id === p.id)).toBe(true);
  });

  it('un rechazo no cobra, no mueve al jugador y no se puede insistir en la ventana', () => {
    const s = newGame(13, 'B'); // de A a B hay un escalón: 35% de aceptar
    const me = userTeam(s)!;
    me.budget = 1_000_000;
    me.squad = me.squad.slice(0, 10);
    const club = otherClub(s, 'A');
    const p = outfield(club);
    s.rngState = rngWhere((x) => x >= 0.35);
    const res = buyPlayer(s, p.id);
    expect(res).toMatchObject({ ok: false, rejected: true });
    expect(me.budget).toBe(1_000_000);
    expect(club.squad.some((x) => x.id === p.id)).toBe(true);
    expect(buyBlocker(s, p.id)).toMatch(/rechaz/i);
    expect(s.news[0]).toMatch(/rechazó/);
  });

  it('respeta presupuesto, plantel máximo, ventana cerrada y lockout', () => {
    const s = newGame(14, 'A');
    const me = userTeam(s)!;
    const club = otherClub(s, 'A');
    const p = outfield(club);
    me.squad = me.squad.slice(0, 10);

    me.budget = clubPrice(p) - 100;
    expect(buyBlocker(s, p.id)).toMatch(/presupuesto/i);
    expect(buyPlayer(s, p.id).ok).toBe(false);
    me.budget = 1_000_000;
    expect(buyBlocker(s, p.id)).toBeNull();

    me.finance.financialLockout = true;
    expect(buyBlocker(s, p.id)).toMatch(/directiva/i);
    me.finance.financialLockout = false;

    while (me.squad.length < SQUAD.max) me.squad.push({ ...me.squad[0], id: `x${me.squad.length}`, number: 50 + me.squad.length });
    expect(buyBlocker(s, p.id)).toMatch(/lleno/i);
    expect(buyPlayer(s, p.id).ok).toBe(false);
    expect(me.squad).toHaveLength(SQUAD.max);
    me.squad = me.squad.slice(0, 10);

    setDay(s, 10);
    expect(buyBlocker(s, p.id)).toMatch(/cerrado/i);
    setDay(s, 16);
    expect(buyBlocker(s, p.id)).toBeNull();
  });

  it('no se le saca el único arquero ni se deja a un club con el plantel mínimo', () => {
    const s = newGame(15, 'A');
    const me = userTeam(s)!;
    me.budget = 1_000_000;
    me.squad = me.squad.slice(0, 10);
    const club = otherClub(s, 'A');
    club.squad = club.squad.filter((p) => p.pos !== 'POR' || p === club.squad.find((x) => x.pos === 'POR'));
    const gk = club.squad.find((p) => p.pos === 'POR')!;
    expect(buyBlocker(s, gk.id)).toMatch(/único arquero/i);
    const p = outfield(club);
    club.squad = club.squad.slice(0, SQUAD.minAfterFire);
    if (!club.squad.includes(p)) club.squad[0] = p;
    expect(buyBlocker(s, p.id)).toMatch(/pocos jugadores/i);
  });

  it('un fichaje no puede ser un jugador propio', () => {
    const s = newGame(16, 'A');
    expect(buyBlocker(s, userTeam(s)!.squad[0].id)).toBe('Ya es tuyo.');
  });
});

describe('ojeadores', () => {
  it('sin ojeadores el potencial es un rango estable que contiene al real; con uno, el real', () => {
    const s = newGame(17);
    for (const p of s.market.freeAgents) {
      const a = scoutedPotential(p, 0);
      expect(a.exact).toBe(false);
      expect(a.min).toBeLessThanOrEqual(p.potential);
      expect(a.max).toBeGreaterThanOrEqual(p.potential);
      expect(a.min).toBeGreaterThanOrEqual(p.rating);
      expect(scoutedPotential(p, 0)).toEqual(a);
      expect(scoutedPotential(p, MARKET.scoutsToReveal)).toEqual({ exact: true, min: p.potential, max: p.potential });
    }
  });
});

describe('ofertas y venta', () => {
  function withListed(seed: number) {
    const s = newGame(seed, 'A');
    const me = userTeam(s)!;
    const p = outfield(me);
    toggleTransferListed(s, p.id);
    return { s, me, p };
  }

  it('marcar transferible y recibir ofertas durante la ventana (precio dentro del rango del original)', () => {
    let found = 0;
    for (let seed = 1; seed <= 60 && found < 3; seed++) {
      const { s, p } = withListed(seed);
      expect(p.transferListed).toBe(true);
      for (const day of [1, 2, 3]) {
        setDay(s, day);
        tickMarket(s);
      }
      for (const o of s.market.offers) {
        found++;
        expect(o.playerId).toBe(p.id);
        const lo = p.contractYears <= 1 ? 0.6 : 0.85, hi = p.contractYears <= 1 ? 0.85 : 1.2;
        expect(o.price).toBeGreaterThanOrEqual(Math.round((p.value * lo) / 100) * 100 - 100);
        expect(o.price).toBeLessThanOrEqual(Math.round((p.value * hi) / 100) * 100 + 100);
        expect(s.news.some((n) => n.includes('ofreció'))).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('sin marcar como transferible no hay ofertas', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = newGame(seed, 'A');
      for (const day of [1, 2, 3]) {
        setDay(s, day);
        tickMarket(s);
      }
      expect(s.market.offers).toEqual([]);
    }
  });

  it('aceptar: cobra el usuario, paga el club, sale del plantel, la alineación y los pateadores', () => {
    const { s, me, p } = withListed(21);
    const club = otherClub(s, 'B');
    club.budget = 500_000;
    me.penaltyTakers = [p.id];
    me.lineup[1] = p.id;
    s.market.offers = [{ playerId: p.id, teamId: club.id, price: 12_300 }];
    const myBefore = me.budget, clubBefore = club.budget, n = club.squad.length;
    const res = acceptOffer(s, p.id, club.id);
    expect(res.ok).toBe(true);
    expect(me.budget).toBe(myBefore + 12_300);
    expect(club.budget).toBe(clubBefore - 12_300);
    expect(me.squad.some((x) => x.id === p.id)).toBe(false);
    expect(me.lineup).not.toContain(p.id);
    expect(me.penaltyTakers).not.toContain(p.id);
    expect(club.squad).toHaveLength(n + 1);
    expect(club.squad.find((x) => x.id === p.id)!.transferListed).toBe(false);
    expect(new Set(club.squad.map((x) => x.number)).size).toBe(club.squad.length);
    expect(s.market.offers).toEqual([]);
    expect(me.finance.log.some((e) => e.concept === 'ventas' && e.amount === 12_300)).toBe(true);
  });

  it('no se puede vender dejando el plantel inválido (mínimo de jugadores o sin arquero)', () => {
    const { s, me, p } = withListed(22);
    const club = otherClub(s, 'B');
    s.market.offers = [{ playerId: p.id, teamId: club.id, price: 5000 }];
    me.squad = me.squad.slice(0, SQUAD.minAfterFire);
    if (!me.squad.includes(p)) me.squad[0] = p;
    expect(sellBlocker(me, p)).toMatch(/mínimo/);
    expect(acceptOffer(s, p.id, club.id)).toMatchObject({ ok: false });
    expect(me.squad.some((x) => x.id === p.id)).toBe(true);

    // único arquero (plantel completo, sin otro arquero)
    const s2 = newGame(25, 'A');
    const me2 = userTeam(s2)!;
    const keeper = me2.squad.find((x) => x.pos === 'POR')!;
    me2.squad = me2.squad.filter((x) => x.pos !== 'POR' || x === keeper);
    keeper.transferListed = true;
    s2.market.offers = [{ playerId: keeper.id, teamId: otherClub(s2, 'B').id, price: 5000 }];
    expect(sellBlocker(me2, keeper)).toMatch(/único arquero/);
    expect(acceptOffer(s2, keeper.id, otherClub(s2, 'B').id)).toMatchObject({ ok: false });
  });

  it('no acepta si la ventana está cerrada ni si el club ya no tiene lugar', () => {
    const { s, me, p } = withListed(23);
    const club = otherClub(s, 'B');
    s.market.offers = [{ playerId: p.id, teamId: club.id, price: 5000 }];
    while (club.squad.length < SQUAD.max) club.squad.push({ ...club.squad[0], id: `y${club.squad.length}`, number: 60 + club.squad.length });
    expect(acceptOffer(s, p.id, club.id)).toMatchObject({ ok: false });
    club.squad = club.squad.slice(0, 12);
    setDay(s, 10);
    expect(acceptOffer(s, p.id, club.id)).toMatchObject({ ok: false });
    expect(me.squad.some((x) => x.id === p.id)).toBe(true);
  });

  it('desmarcar como transferible borra sus ofertas', () => {
    const { s, p } = withListed(24);
    s.market.offers = [{ playerId: p.id, teamId: otherClub(s, 'B').id, price: 5000 }];
    toggleTransferListed(s, p.id);
    expect(s.market.offers).toEqual([]);
  });
});

describe('cartera', () => {
  it('seguir y dejar de seguir; no se puede seguir a un propio ni a un agente libre', () => {
    const s = newGame(31, 'A');
    const p = outfield(otherClub(s, 'B'));
    expect(toggleWatch(s, p.id)).toEqual({ ok: true, watching: true });
    expect(isWatched(s, p.id)).toBe(true);
    expect(s.watchlist[0].since).toMatchObject({ rating: p.rating, potential: p.potential });
    expect(toggleWatch(s, p.id)).toEqual({ ok: true, watching: false });
    expect(s.watchlist).toEqual([]);
    expect(toggleWatch(s, userTeam(s)!.squad[0].id).ok).toBe(false);
    expect(toggleWatch(s, s.market.freeAgents[0].id).ok).toBe(false);
  });

  it('registra la evolución al cambiar de temporada y se limpia al fichar al jugador', () => {
    const s = newGame(32, 'A');
    const young = allTeams(s)
      .filter((t) => t.id !== s.userTeamId)
      .flatMap((t) => t.squad)
      .find((p) => p.age <= 22)!;
    toggleWatch(s, young.id);
    expect(s.watchlist[0].history).toHaveLength(1);
    while (!isSeasonOver(s)) playMatchday(s);
    startNewSeason(s);
    const e = s.watchlist.find((x) => x.playerId === young.id)!;
    expect(e.history.map((h) => h.season)).toEqual([1, 2]);
    expect(e.history[1].rating).toBe(allTeams(s).flatMap((t) => t.squad).find((p) => p.id === young.id)!.rating);

    const s2 = newGame(33, 'A');
    const me = userTeam(s2)!;
    me.budget = 1_000_000;
    me.squad = me.squad.slice(0, 10);
    const p = outfield(otherClub(s2, 'A'));
    toggleWatch(s2, p.id);
    s2.rngState = rngWhere((x) => x < 0.9);
    expect(buyPlayer(s2, p.id).ok).toBe(true);
    expect(isWatched(s2, p.id)).toBe(false);
  });
});

describe('h2h y clásico', () => {
  it('recordH2H guarda por par y se lee desde cualquiera de los dos lados', () => {
    const s = createNewGame(41, 'DT');
    const [a, b] = s.divisions.A.teams;
    recordH2H(s, a.id, b.id, 3, 1);
    recordH2H(s, b.id, a.id, 2, 2);
    recordH2H(s, b.id, a.id, 4, 0);
    expect(Object.keys(s.h2h)).toHaveLength(1);
    expect(h2hFor(s, a.id, b.id)).toEqual({ played: 3, w: 1, d: 1, l: 1, gf: 5, ga: 7 });
    expect(h2hFor(s, b.id, a.id)).toEqual({ played: 3, w: 1, d: 1, l: 1, gf: 7, ga: 5 });
    expect(h2hFor(s, a.id, s.divisions.A.teams[2].id).played).toBe(0);
  });

  it(`el rival necesita ${RIVALRY.minMatches} partidos y gana el más parejo`, () => {
    const s = newGame(42, 'A');
    const me = userTeam(s)!;
    const [x, y] = s.divisions.A.teams.filter((t) => t.id !== me.id);
    expect(getUserRivalId(s)).toBeNull();
    recordH2H(s, me.id, x.id, 1, 0);
    recordH2H(s, me.id, x.id, 1, 0);
    expect(getUserRivalId(s)).toBeNull();
    recordH2H(s, me.id, x.id, 1, 0); // 3 de 3: nada parejo
    expect(getUserRivalId(s)).toBe(x.id);
    recordH2H(s, me.id, y.id, 1, 0);
    recordH2H(s, y.id, me.id, 1, 1);
    recordH2H(s, me.id, y.id, 0, 2);
    expect(getUserRivalId(s)).toBe(y.id); // 1G 1E 1P: más parejo
    expect(isRivalMatch(s, me.id, y.id)).toBe(true);
    expect(isRivalMatch(s, y.id, me.id)).toBe(true);
    expect(isRivalMatch(s, me.id, x.id)).toBe(false);
    expect(isRivalMatch(s, x.id, y.id)).toBe(false);
  });

  it('computeAttendance suma el bono de clásico (HTML 525: +0,18) con el mismo azar', () => {
    const s = newGame(43, 'A');
    const home = userTeam(s)!;
    home.stadium.capacity = 1000;
    home.morale = 0;
    home.finance.ticketPrice = 30;
    const a = computeAttendance(home, 'A', createRng(9), false);
    const b = computeAttendance(home, 'A', createRng(9), true);
    expect(b - a).toBe(Math.round(1000 * ECONOMY.attendance.rivalBonus));
  });

  it('playMatchday guarda el h2h de todos los pares y cobra más entradas en el clásico', () => {
    const s = newGame(44, 'A');
    const fx0 = s.divisions.A.schedule[0].find(([h, a]) => h === s.userTeamId || a === s.userTeamId)!;
    // que el usuario sea local en la fecha 1
    s.userTeamId = fx0[0];
    const me = userTeam(s)!;
    me.stadium.capacity = 1000;
    me.morale = 0;
    me.finance.ticketPrice = 30; // baja la asistencia base para que el bono no quede topado
    const opp = fx0[1];
    const classic = structuredClone(s);
    recordH2H(classic, me.id, opp, 1, 0);
    recordH2H(classic, opp, me.id, 1, 1);
    recordH2H(classic, me.id, opp, 0, 1);
    expect(isRivalMatch(classic, me.id, opp)).toBe(true);
    playMatchday(s);
    playMatchday(classic);
    expect(Object.keys(s.h2h)).toHaveLength(27); // 9 partidos × 3 divisiones
    expect(h2hFor(s, me.id, opp).played).toBe(1);
    const gate = (g: GameState) => userTeam(g)!.finance.totals.byConcept.entradas ?? 0;
    expect(gate(classic)).toBeGreaterThan(gate(s));
  });
});

describe('mercado de la computadora', () => {
  it('es determinista con la misma semilla', () => {
    const run = () => {
      const s = newGame(51, 'A');
      while (!isSeasonOver(s)) playMatchday(s);
      startNewSeason(s);
      return s;
    };
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });

  it('fichajes: no rompe plantillas (máx 20, mín 8, arquero) y publica noticias de la división del usuario', () => {
    const s = newGame(52, 'A');
    let signings = 0;
    while (!isSeasonOver(s)) {
      playMatchday(s);
      signings += s.news.filter((n) => n.startsWith('💼')).length;
    }
    for (const t of allTeams(s)) {
      expect(t.squad.length).toBeLessThanOrEqual(SQUAD.max);
      expect(t.squad.length).toBeGreaterThanOrEqual(MARKET.ai.sellMinSquad);
      expect(t.squad.some((p) => p.pos === 'POR')).toBe(true);
      expect(new Set(t.squad.map((p) => p.number)).size).toBe(t.squad.length);
      expect(t.lineup.every((id) => id === null || t.squad.some((p) => p.id === id))).toBe(true);
    }
    expect(s.market.aiDone.length).toBeGreaterThan(0);
    expect(signings).toBeGreaterThanOrEqual(0);
  });

  it('frena la acumulación de plata: mediana de presupuestos de la computadora ≤ ~1,5× la inicial al terminar la temporada', () => {
    const lines: string[] = [];
    for (const seed of [7, 99, 2024]) {
      const s = createNewGame(seed, 'DT');
      s.userDivision = 'A';
      s.userTeamId = s.divisions.A.teams[0].id;
      const cpu = () => allTeams(s).filter((t) => t.id !== s.userTeamId);
      const initial = new Map(cpu().map((t) => [t.id, t.budget]));
      const m0 = med([...initial.values()]);
      tickMarket(s);
      while (!isSeasonOver(s)) playMatchday(s);
      const end = cpu().map((t) => t.budget);
      const ratio = med(end) / m0;
      const sorted = [...end].sort((a, b) => a - b);
      lines.push(
        `semilla ${seed}: inicial mediana ${m0} -> final mediana ${med(end)} (x${ratio.toFixed(2)}); min x${(sorted[0] / m0).toFixed(2)}, ` +
          `p90 x${(sorted[Math.floor(sorted.length * 0.9)] / m0).toFixed(2)}, max x${(sorted[sorted.length - 1] / m0).toFixed(2)}`,
      );
      expect(ratio).toBeLessThanOrEqual(1.5);
      expect(ratio).toBeGreaterThan(0.5);
    }
    console.log(lines.join('\n'));
  });

  it('el nivel de las divisiones no se desploma ni se dispara en una temporada', () => {
    const s = newGame(53, 'A');
    const level = () => DIVS.map((d) => s.divisions[d].teams.reduce((a, t) => a + teamStrength(t), 0) / 18);
    const before = level();
    while (!isSeasonOver(s)) playMatchday(s);
    const after = level();
    after.forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThan(8));
    console.log(`fuerza media por división (A/B/C): antes ${before.map((x) => x.toFixed(1))} despues ${after.map((x) => x.toFixed(1))}`);
  });
});

describe('migración de guardado 3 → 4', () => {
  it('completa pretemporada, mercado, cartera y h2h, y la partida sigue andando', () => {
    const s = newGame(61, 'A');
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.version = 3;
    for (const k of ['preseasonWeeksLeft', 'market', 'watchlist', 'h2h']) delete raw[k];
    const loaded = parseSave(raw)!;
    expect(CURRENT_SAVE_VERSION).toBe(6);
    expect(loaded.version).toBe(6);
    expect(loaded.preseasonWeeksLeft).toBe(0);
    expect(loaded.market).toMatchObject({ freeAgents: [], clubListings: [], offers: [], aiDone: [], refused: [] });
    expect(loaded.watchlist).toEqual([]);
    expect(loaded.h2h).toEqual({});
    tickMarket(loaded); // al cargar, se arma el mercado de la ventana en curso
    expect(loaded.market.freeAgentsWindow).toBe('early-1');
    expect(loaded.market.freeAgents.length).toBeGreaterThan(0);
    while (!isSeasonOver(loaded)) playMatchday(loaded);
    expect(Object.keys(loaded.h2h).length).toBeGreaterThan(0);
  });

  it('migrateV3toV4 no pisa lo que ya existe', () => {
    const out = migrateV3toV4({ version: 3, watchlist: [{ playerId: 'a' }], preseasonWeeksLeft: 1 });
    expect(out.watchlist).toEqual([{ playerId: 'a' }]);
    expect(out.preseasonWeeksLeft).toBe(1);
  });
});
