import { describe, expect, it } from 'vitest';
import type { DivisionId, GameState, Team } from '../domain/types';
import { parseSave } from '../repo/saveSchema';
import { ECONOMY, STADIUM_UPGRADES, STAFF } from './config';
import {
  canSpend, chooseSponsorOffer, computeAttendance, ensureSponsorOffers, fireStaff, hireCost, hireStaff,
  matchdayExpenses, processClubFinances, renameStadium, setTicketPrice, squadWages, staffWages, upgradeCost,
  upgradeStadium,
} from './finance';
import { createNewGame } from './generate';
import { createRng } from './rng';
import { isSeasonOver, playMatchday, startNewSeason, userTeam } from './season';
import { renewContract } from './squad';

function newGame(seed = 31): GameState {
  const s = createNewGame(seed, 'DT');
  s.userDivision = 'A';
  s.userTeamId = s.divisions.A.teams[0].id;
  return s;
}

const ctx = { season: 1, matchday: null };
const day = (isHome: boolean, attendance = 500) => ({ season: 1, matchday: 0, isHome, attendance });

describe('asistencia y precio de la entrada', () => {
  it('con el mismo azar, más precio => menos gente', () => {
    const t = newGame().divisions.A.teams[0];
    const at = (price: number) => {
      t.finance.ticketPrice = price;
      return computeAttendance(t, 'A', createRng(5));
    };
    expect(at(8)).toBeGreaterThan(at(14));
    expect(at(14)).toBeGreaterThan(at(30));
  });

  it('nunca supera la capacidad y tiene un piso de 8%', () => {
    const t = newGame().divisions.A.teams[0];
    t.stadium.capacity = 1000;
    t.morale = 100;
    t.finance.ticketPrice = 1;
    for (let i = 1; i < 50; i++) expect(computeAttendance(t, 'A', createRng(i), true)).toBeLessThanOrEqual(1000);
    t.finance.ticketPrice = ECONOMY.ticketMax;
    t.morale = 0;
    expect(computeAttendance(t, 'C', createRng(1))).toBe(Math.round(1000 * ECONOMY.attendance.minRate));
  });

  it('la división y la moral suman gente', () => {
    const t = newGame().divisions.A.teams[0];
    t.finance.ticketPrice = 9;
    const a = (div: DivisionId, morale: number) => {
      t.morale = morale;
      return computeAttendance(t, div, createRng(9));
    };
    expect(a('A', 50)).toBeGreaterThan(a('C', 50));
    expect(a('B', 90)).toBeGreaterThan(a('B', 20));
  });

  it('el precio queda dentro de los límites del original', () => {
    const t = newGame().divisions.A.teams[0];
    expect(setTicketPrice(t, 500)).toBe(ECONOMY.ticketMax);
    expect(setTicketPrice(t, -3)).toBe(ECONOMY.ticketMin);
    expect(setTicketPrice(t, 12.4)).toBe(12);
    expect(t.finance.ticketPrice).toBe(12);
  });
});

describe('ingresos y gastos por fecha', () => {
  it('de visitante: sponsor - sueldos - staff - mantenimiento; de local, además las entradas', () => {
    const t = newGame().divisions.A.teams[0];
    t.staff.medics = 2;
    const before = t.budget;
    processClubFinances(t, day(false), false);
    const away = t.budget - before;
    expect(away).toBe(t.finance.sponsor.perMatch - matchdayExpenses(t));
    expect(staffWages(t)).toBe(3 * ECONOMY.staffWage);
    expect(squadWages(t)).toBeGreaterThan(0);
    processClubFinances(t, day(true, 400), false);
    expect(t.budget - before - away).toBe(away + 400 * t.finance.ticketPrice);
    // historial y totales de la temporada por concepto
    expect(t.finance.totals.byConcept.entradas).toBe(400 * t.finance.ticketPrice);
    expect(t.finance.totals.byConcept.sueldos).toBe(-2 * squadWages(t));
    expect(t.finance.log.length).toBeLessThanOrEqual(ECONOMY.logSizeCpu);
  });

  it('playMatchday cobra a todos los equipos, no solo al del usuario', () => {
    const s = newGame();
    const snapshot = new Map(
      (['A', 'B', 'C'] as const).flatMap((d) => s.divisions[d].teams.map((t) => [t.id, t.budget] as const)),
    );
    const fixtures = (['A', 'B', 'C'] as const).flatMap((d) => s.divisions[d].schedule[0].map(([h, a]) => ({ d, h, a })));
    const exp = new Map(
      (['A', 'B', 'C'] as const).flatMap((d) =>
        s.divisions[d].teams.map((t) => [t.id, t.finance.sponsor.perMatch - matchdayExpenses(t)] as const),
      ),
    );
    playMatchday(s);
    for (const { d, h, a } of fixtures) {
      const home = s.divisions[d].teams.find((t) => t.id === h)!;
      const away = s.divisions[d].teams.find((t) => t.id === a)!;
      expect(away.budget - snapshot.get(a)!).toBe(exp.get(a));
      const gate = home.budget - snapshot.get(h)! - exp.get(h)!;
      expect(gate).toBeGreaterThan(0);
      expect(gate).toBeLessThanOrEqual(home.stadium.capacity * home.finance.ticketPrice);
      expect(home.finance.log.length).toBeGreaterThan(0);
    }
  });
});

describe('deuda y lockout', () => {
  it(`tras ${ECONOMY.lockoutThreshold} fechas en rojo la directiva restringe los gastos`, () => {
    const s = newGame();
    const t = userTeam(s)!;
    t.budget = -5_000_000;
    const news: string[] = [];
    for (let i = 0; i < ECONOMY.lockoutThreshold - 1; i++) processClubFinances(t, day(false), true, (x) => news.push(x));
    expect(t.finance.debtStreak).toBe(ECONOMY.lockoutThreshold - 1);
    expect(canSpend(t)).toBe(true);
    processClubFinances(t, day(false), true, (x) => news.push(x));
    expect(t.finance.financialLockout).toBe(true);
    expect(canSpend(t)).toBe(false);
    expect(news).toHaveLength(1);
    expect(news[0]).toContain('restringió');
  });

  it('bloquea renovar, contratar staff y ampliar; al salir de la deuda se levanta', () => {
    const s = newGame();
    const t = userTeam(s)!;
    t.budget = 10_000_000;
    t.finance.financialLockout = true;
    const p = t.squad.find((x) => x.contractYears < 3)!;
    const rng = createRng(1);
    expect(renewContract(t, p.id, rng)).toMatchObject({ ok: false });
    expect(hireStaff(t, 'medics', ctx)).toMatchObject({ ok: false });
    expect(upgradeStadium(t, 'small', ctx)).toMatchObject({ ok: false });
    expect(t.budget).toBe(10_000_000);
    expect(t.staff.medics).toBe(0);
    const news: string[] = [];
    processClubFinances(t, day(false), true, (x) => news.push(x)); // presupuesto positivo
    expect(t.finance.financialLockout).toBe(false);
    expect(t.finance.debtStreak).toBe(0);
    expect(news[0]).toContain('autorizar');
    expect(renewContract(t, p.id, rng)).toMatchObject({ ok: true });
    expect(hireStaff(t, 'medics', ctx)).toMatchObject({ ok: true });
  });
});

describe('estadio', () => {
  it('ampliar cuesta capacidad × mult y suma lugares; renombrar corta en 30', () => {
    const t = newGame().divisions.A.teams[0];
    t.budget = 1_000_000;
    t.stadium.capacity = 1000;
    for (const u of STADIUM_UPGRADES) {
      const cap = t.stadium.capacity;
      const cost = upgradeCost(cap, u.key);
      expect(cost).toBe(Math.round((cap * u.mult) / 10) * 10);
      const b = t.budget;
      expect(upgradeStadium(t, u.key, ctx)).toEqual({ ok: true, cost });
      expect(t.stadium.capacity).toBe(cap + u.add);
      expect(t.budget).toBe(b - cost);
    }
    expect(t.finance.totals.byConcept.estadio).toBeLessThan(0);
    t.budget = 0;
    expect(upgradeStadium(t, 'small', ctx)).toMatchObject({ ok: false });
    expect(renameStadium(t, 'x'.repeat(50))).toEqual({ ok: true });
    expect(t.stadium.name).toHaveLength(30);
    expect(renameStadium(t, '   ')).toMatchObject({ ok: false });
  });
});

describe('staff', () => {
  it('contratar cuesta 5000 + 3500 por cada uno que ya tenés y respeta el tope', () => {
    const t = newGame().divisions.A.teams[0];
    t.budget = 1_000_000;
    expect(hireCost(t, 'doctors')).toBe(5000);
    expect(hireStaff(t, 'doctors', ctx)).toMatchObject({ ok: true, cost: 5000 });
    expect(hireCost(t, 'doctors')).toBe(8500);
    hireStaff(t, 'doctors', ctx);
    hireStaff(t, 'doctors', ctx);
    expect(t.staff.doctors).toBe(3);
    expect(hireStaff(t, 'doctors', ctx)).toMatchObject({ ok: false });
    expect(STAFF.defs.find((d) => d.key === 'trainers')!.max).toBe(7);
  });

  it('despedir quita el sueldo; el último preparador no se puede despedir', () => {
    const t = newGame().divisions.A.teams[0];
    t.staff.scouts = 1;
    const w = staffWages(t);
    expect(fireStaff(t, 'scouts')).toMatchObject({ ok: true });
    expect(staffWages(t)).toBe(w - ECONOMY.staffWage);
    expect(fireStaff(t, 'scouts')).toMatchObject({ ok: false });
    expect(fireStaff(t, 'trainers')).toMatchObject({ ok: false });
  });

  it('los médicos acortan las lesiones en playMatchday (mismas semillas, más médicos => lesiones más cortas)', () => {
    const mean = (doctors: number) => {
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const s = createNewGame(seed, 'DT');
        for (const d of ['A', 'B', 'C'] as const) {
          for (const t of s.divisions[d].teams) {
            t.staff.doctors = doctors;
            for (const p of t.squad) p.injuryProneness = 1.8;
            for (const p of t.squad) p.fatigue = 80;
          }
        }
        playMatchday(s);
        for (const d of ['A', 'B', 'C'] as const)
          for (const t of s.divisions[d].teams) for (const p of t.squad) if (p.injury) {
              sum += p.injury.matchesLeft;
              n++;
            }
      }
      return sum / n;
    };
    expect(mean(3)).toBeLessThan(mean(0) * 0.8);
  });

  it('los fisios aceleran la recuperación de los que no juegan', () => {
    const run = (medics: number) => {
      const s = newGame(8);
      const t = userTeam(s)!;
      t.staff.medics = medics;
      const bench = t.squad.find((p) => !t.lineup.includes(p.id))!;
      bench.fatigue = 60;
      playMatchday(s);
      return bench.fatigue;
    };
    expect(run(3)).toBeLessThan(run(0));
  });
});

describe('sponsors', () => {
  it('al empezar la temporada el usuario tiene 3 ofertas y la computadora elige sola', () => {
    const s = newGame();
    ensureSponsorOffers(s);
    expect(s.sponsorOffers?.season).toBe(1);
    expect(s.sponsorOffers?.offers).toHaveLength(3);
    const me = userTeam(s)!;
    const before = me.budget;
    const offer = s.sponsorOffers!.offers[0];
    expect(chooseSponsorOffer(s, 0)).toMatchObject({ ok: true });
    expect(me.finance.sponsor).toEqual({ name: offer.name, perMatch: offer.perMatch, season: 1 });
    expect(me.budget).toBe(before + offer.bonus);
    expect(s.sponsorOffers).toBeNull();
    expect(chooseSponsorOffer(s, 0)).toMatchObject({ ok: false });

    // temporada siguiente: se rearma la oferta y los demás ya firmaron solos
    while (!isSeasonOver(s)) playMatchday(s);
    startNewSeason(s);
    expect(s.season).toBe(2);
    expect(s.sponsorOffers?.season).toBe(2);
    const cpu = s.divisions.A.teams.find((t) => t.id !== s.userTeamId)!;
    expect(cpu.finance.sponsor.season).toBe(2);
    expect(userTeam(s)!.finance.sponsor.season).toBe(1); // sigue con el anterior hasta elegir
  });
});

describe('migración de guardado 2 → 3', () => {
  it('completa finanzas y staff, y la partida sigue andando', () => {
    const s = createNewGame(5, 'DT');
    const raw = JSON.parse(JSON.stringify(s));
    raw.version = 2;
    delete raw.sponsorOffers;
    for (const d of ['A', 'B', 'C']) for (const t of raw.divisions[d].teams) {
        delete t.finance;
        delete t.staff;
      }
    const loaded = parseSave(raw)!;
    expect(loaded.version).toBe(3);
    expect(loaded.sponsorOffers).toBeNull();
    const t = loaded.divisions.B.teams[0];
    expect(t.finance.ticketPrice).toBe(ECONOMY.baseTicketPrice.B);
    expect(t.finance.sponsor.perMatch).toBeGreaterThanOrEqual(ECONOMY.startSponsor.min);
    expect(t.finance.sponsor.perMatch).toBeLessThanOrEqual(ECONOMY.startSponsor.max);
    expect(t.finance).toMatchObject({ log: [], debtStreak: 0, financialLockout: false });
    expect(t.staff).toEqual({ trainers: 1, medics: 0, doctors: 0, scouts: 0, youthCoaches: 0 });
    loaded.userDivision = 'A';
    loaded.userTeamId = loaded.divisions.A.teams[0].id;
    playMatchday(loaded);
    expect(Number.isFinite(loaded.divisions.A.teams[0].budget)).toBe(true);
  });
});

describe('una temporada completa', () => {
  it('no deja presupuestos NaN y la computadora no quiebra de forma absurda', () => {
    const s = newGame(2025);
    ensureSponsorOffers(s);
    while (!isSeasonOver(s)) playMatchday(s);
    const rows: { div: DivisionId; t: Team }[] = (['A', 'B', 'C'] as const).flatMap((div) =>
      s.divisions[div].teams.map((t) => ({ div, t })),
    );
    for (const { t } of rows) {
      expect(Number.isFinite(t.budget)).toBe(true);
      expect(Number.isFinite(t.stadium.capacity)).toBe(true);
    }
    for (const div of ['A', 'B', 'C'] as const) {
      const b = rows.filter((r) => r.div === div && r.t.id !== s.userTeamId).map((r) => r.t.budget).sort((x, y) => x - y);
      const q = (p: number) => b[Math.min(b.length - 1, Math.floor(p * b.length))];
      console.log(`Presupuestos fin de temporada, div ${div} (CPU): min ${b[0]} · p25 ${q(0.25)} · mediana ${q(0.5)} · p75 ${q(0.75)} · max ${b[b.length - 1]} · en rojo ${b.filter((x) => x < 0).length}/${b.length}`);
    }
    const cpu = rows.filter((r) => r.t.id !== s.userTeamId);
    expect(cpu.filter((r) => r.t.budget < 0).length / cpu.length).toBeLessThan(0.1);
    expect(cpu.filter((r) => r.t.finance.financialLockout).length / cpu.length).toBeLessThan(0.1);
  });
});
