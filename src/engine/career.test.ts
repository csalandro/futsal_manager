import { describe, expect, it } from 'vitest';
import type { GameState, Team, Tie } from '../domain/types';
import { parseSave, CURRENT_SAVE_VERSION } from '../repo/saveSchema';
import { SQUAD, TRAINING, YOUTH } from './config';
import {
  acceptJobOffer, boardPressure, DT_NAME_MAX, failureStreak, isDoomedClub, openJobOffers, openTenure, renameDt, rollJobOffers, setDtAge, shouldFire,
} from './dt';
import { fireStaff, hireStaff } from './finance';
import { createNewGame, generatePlayer } from './generate';
import { toggleWatch } from './market';
import { createRng, type Rng } from './rng';
import { isSeasonOver, playNextStep, startNewSeason, userNextFixture, userTeam, waitForOffers } from './season';
import {
  baseGrowthChance, growthChance, processTraining, setTrainingIntensity, toggleTraining, trainingCap, trainingFacilityCost,
  upgradeTrainingFacility,
} from './training';
import { academyFacilityCost, ageAcademy, demoteToAcademy, promoteYouth, sellYouth, upgradeAcademy, youthSellPrice } from './youth';
import { allTeams, teamDivision } from './world';

const ctx = { season: 1, matchday: null };

function newGame(seed = 31): GameState {
  const s = createNewGame(seed, 'DT');
  s.userDivision = 'A';
  s.userTeamId = s.divisions.A.teams[0].id;
  openTenure(s);
  return s;
}

function playSeason(s: GameState): void {
  for (let guard = 0; !isSeasonOver(s) && guard < 200; guard++) playNextStep(s);
}

/** Rng de azar fijo: todo "pasa" (chance), los enteros caen en el mínimo. */
const lucky: Rng = { next: () => 0, int: (a) => a, pick: (arr) => arr[0], chance: () => true, id: () => 'x', state: () => 0 };

/** Equipo del usuario con plantel y cantera conocidos. */
function userWith(s: GameState): Team {
  return userTeam(s)!;
}

describe('cantera: generación', () => {
  it('todos los equipos arrancan con 12 juveniles de 15 a 18 (3 por edad) y los invitados sin cantera', () => {
    const s = createNewGame(5, 'DT');
    for (const t of allTeams(s)) {
      expect(t.academy).toHaveLength(12);
      for (const age of YOUTH.startAges) expect(t.academy.filter((p) => p.age === age)).toHaveLength(3);
      expect(t.academyFacility).toBe(0);
      expect(t.trainingFacility).toBe(0);
    }
  });

  it('la cantera de A es de mayor potencial que la de C (bono por división) y respeta el techo', () => {
    const s = createNewGame(6, 'DT');
    const avg = (d: 'A' | 'B' | 'C') => {
      const all = s.divisions[d].teams.flatMap((t) => t.academy);
      return all.reduce((a, p) => a + p.potential, 0) / all.length;
    };
    expect(avg('A')).toBeGreaterThan(avg('B'));
    expect(avg('B')).toBeGreaterThan(avg('C'));
    for (const p of s.divisions.C.teams.flatMap((t) => t.academy)) expect(p.potential).toBeLessThanOrEqual(YOUTH.divCap.C);
    for (const t of allTeams(s)) for (const p of t.academy) expect(p.rating).toBeLessThanOrEqual(YOUTH.ratingCap);
  });

  it('con ojeadores nacen mejores (en promedio)', () => {
    const base = createNewGame(7, 'DT');
    const t0 = base.divisions.A.teams[0];
    const withScouts = structuredClone(base);
    const t1 = withScouts.divisions.A.teams[0];
    t1.staff.scouts = 3;
    t0.academy = [];
    t1.academy = [];
    for (let i = 0; i < 40; i++) {
      ageAcademy(base, t0, false, createRng(100 + i));
      ageAcademy(withScouts, t1, false, createRng(100 + i));
    }
    const avg = (t: Team) => t.academy.reduce((a, p) => a + p.potential, 0) / t.academy.length;
    expect(avg(t1)).toBeGreaterThan(avg(t0) + 4);
  });
});

describe('cantera: envejecimiento anual y promoción obligatoria', () => {
  it('a los 19 suben al primer equipo, entran 3 de 15 y los demás crecen', () => {
    const s = newGame();
    const t = userWith(s);
    const before = t.squad.length;
    const ratings = new Map(t.academy.map((p) => [p.id, p.rating]));
    const promoted = ageAcademy(s, t, true, createRng(1));
    expect(promoted).toHaveLength(3); // los de 18 cumplen 19
    expect(t.squad).toHaveLength(before + 3);
    for (const p of promoted) {
      expect(p.age).toBe(YOUTH.promoteAge);
      expect(p.peakStart).not.toBeNull();
      expect(p.contractYears).toBeGreaterThanOrEqual(YOUTH.contractYears[0]);
      expect(t.squad.filter((x) => x.number === p.number)).toHaveLength(1); // número libre
    }
    expect(t.academy).toHaveLength(12);
    expect(t.academy.filter((p) => p.age === YOUTH.intakeAge)).toHaveLength(YOUTH.intake);
    expect(t.academy.every((p) => p.age >= 15 && p.age <= 18)).toBe(true);
    for (const p of t.academy.filter((x) => ratings.has(x.id))) expect(p.rating).toBeGreaterThanOrEqual(ratings.get(p.id)!);
    expect(s.news.some((n) => n.includes('promovido obligatoriamente'))).toBe(true);
  });

  it('con el plantel en 20 el que cumple 19 queda libre (tope de 20)', () => {
    const s = newGame();
    const t = userWith(s);
    const rng = createRng(9);
    while (t.squad.length < SQUAD.max - 1) t.squad.push(generatePlayer(rng, 'ALA', 50));
    const promoted = ageAcademy(s, t, true, createRng(2));
    expect(promoted).toHaveLength(1);
    expect(t.squad).toHaveLength(SQUAD.max);
    expect(t.academy).toHaveLength(12);
    expect(s.news.filter((n) => n.includes('quedó libre'))).toHaveLength(2);
  });

  it('el centro y el entrenador de juveniles aceleran el crecimiento y adelantan el pico', () => {
    const grow = (facility: number, coaches: number) => {
      const s = newGame();
      const t = userWith(s);
      t.academyFacility = facility;
      t.staff.youthCoaches = coaches;
      for (const p of t.academy) {
        p.rating = 30;
        p.potential = 90;
      }
      ageAcademy(s, t, false, createRng(4));
      return t.academy.filter((p) => p.age < 19 && p.age > 15).reduce((a, p) => a + p.rating, 0);
    };
    expect(grow(4, 1)).toBeGreaterThan(grow(0, 0));
    const s = newGame();
    const t = userWith(s);
    const peak = () => {
      const p = structuredClone(t.academy[0]);
      p.age = 18;
      t.academy = [p, ...t.academy.slice(1)];
      ageAcademy(s, t, false, createRng(3));
      return t.squad.find((x) => x.id === p.id)!.peakStart!;
    };
    const slow = peak();
    t.academyFacility = 5;
    t.staff.youthCoaches = 1;
    expect(peak()).toBeLessThan(slow);
  });

  it('startNewSeason: todos los equipos (computadora incluida) siguen con 12 juveniles y plantel entre 10 y 20', () => {
    const s = newGame(12);
    for (let y = 0; y < 3; y++) {
      playSeason(s);
      startNewSeason(s);
      if (s.dt.unemployed) acceptJobOffer(s, s.dt.jobOffers[0].teamId);
      for (const t of allTeams(s)) {
        expect(t.academy).toHaveLength(12);
        expect(t.academy.every((p) => p.age >= 15 && p.age <= 18)).toBe(true);
        expect(t.squad.length).toBeGreaterThanOrEqual(SQUAD.minSeason);
        expect(t.squad.length).toBeLessThanOrEqual(SQUAD.max);
      }
    }
  });
});

describe('cantera: acciones del usuario', () => {
  it('vender un juvenil cobra el 50% de su valor y lo anota en la caja', () => {
    const s = newGame();
    const t = userWith(s);
    const p = t.academy[0];
    const price = Math.round((p.value * 0.5) / 100) * 100;
    expect(youthSellPrice(p)).toBe(price);
    const budget = t.budget;
    const res = sellYouth(t, p.id, ctx);
    expect(res).toEqual({ ok: true, cost: -price });
    expect(t.budget).toBe(budget + price);
    expect(t.academy.some((x) => x.id === p.id)).toBe(false);
    expect(t.finance.log.at(-1)).toMatchObject({ concept: 'ventas', amount: price });
    expect(sellYouth(t, p.id, ctx).ok).toBe(false);
  });

  it('subir antes de tiempo solo con lugar en el plantel; bajar solo a menores de 19', () => {
    const s = newGame();
    const t = userWith(s);
    const rng = createRng(5);
    const kid = t.academy.find((p) => p.age === 16)!;
    expect(promoteYouth(t, kid.id, rng).ok).toBe(true);
    expect(t.squad.some((p) => p.id === kid.id)).toBe(true);
    expect(t.academy.some((p) => p.id === kid.id)).toBe(false);
    expect(demoteToAcademy(t, kid.id).ok).toBe(true);
    expect(t.academy.some((p) => p.id === kid.id)).toBe(true);
    expect(t.squad.some((p) => p.id === kid.id)).toBe(false);
    const vet = t.squad.find((p) => p.age >= 19)!;
    expect(demoteToAcademy(t, vet.id).ok).toBe(false);
    while (t.squad.length < SQUAD.max) t.squad.push(generatePlayer(rng, 'ALA', 50));
    const again = promoteYouth(t, t.academy[0].id, rng);
    expect(again.ok).toBe(false);
  });

  it('mejorar el centro juvenil y el de entrenamiento: costo por nivel, tope en 5, falta de plata y gastos restringidos', () => {
    const s = newGame();
    const t = userWith(s);
    t.budget = 1_000_000;
    expect(academyFacilityCost(t)).toBe(6000);
    expect(trainingFacilityCost(t)).toBe(7000);
    for (let lvl = 0; lvl < 5; lvl++) {
      const cost = 6000 * (lvl + 1);
      const b = t.budget;
      expect(upgradeAcademy(t, ctx)).toEqual({ ok: true, cost });
      expect(t.budget).toBe(b - cost);
      expect(t.academyFacility).toBe(lvl + 1);
    }
    expect(upgradeAcademy(t, ctx).ok).toBe(false);
    for (let lvl = 0; lvl < 5; lvl++) expect(upgradeTrainingFacility(t, ctx)).toEqual({ ok: true, cost: 7000 * (lvl + 1) });
    expect(upgradeTrainingFacility(t, ctx)).toMatchObject({ ok: false });
    expect(t.finance.log.some((e) => e.concept === 'instalaciones')).toBe(true);

    const poor = userWith(newGame(32));
    poor.budget = 100;
    expect(upgradeAcademy(poor, ctx)).toMatchObject({ ok: false, reason: 'No alcanza el presupuesto.' });
    expect(upgradeTrainingFacility(poor, ctx).ok).toBe(false);
    const locked = userWith(newGame(33));
    locked.budget = 1_000_000;
    locked.finance.financialLockout = true;
    expect(upgradeAcademy(locked, ctx).ok).toBe(false);
    expect(upgradeTrainingFacility(locked, ctx).ok).toBe(false);
    expect(locked.academyFacility + locked.trainingFacility).toBe(0);
    expect(locked.budget).toBe(1_000_000);
  });
});

describe('entrenamiento individual', () => {
  /** Tres jugadores jóvenes con margen de crecimiento. */
  function trainees(team: Team) {
    const picks = team.squad.filter((p) => p.pos !== 'POR').slice(0, 3);
    for (const p of picks) {
      p.age = 19;
      p.rating = 50;
      p.potential = 80;
    }
    return picks;
  }

  it('cupos: 3 por preparador; no se entrena quien ya llegó a su potencial', () => {
    const s = newGame();
    const t = userWith(s);
    expect(trainingCap(t)).toBe(3);
    const field = t.squad.filter((p) => p.pos !== 'POR');
    for (const p of field) p.potential = Math.max(p.potential, p.rating + 5);
    for (const p of field.slice(0, 3)) expect(toggleTraining(t, p.id).ok).toBe(true);
    expect(toggleTraining(t, field[3].id)).toMatchObject({ ok: false });
    t.budget = 100_000;
    expect(hireStaff(t, 'trainers', ctx).ok).toBe(true);
    expect(trainingCap(t)).toBe(6);
    expect(toggleTraining(t, field[3].id).ok).toBe(true);
    const maxed = field[4];
    maxed.rating = maxed.potential;
    expect(toggleTraining(t, maxed.id)).toMatchObject({ ok: false });
    expect(toggleTraining(t, field[0].id).ok).toBe(true); // se puede quitar
    expect(t.training).not.toContain(field[0].id);
  });

  it('despedir preparadores recorta la lista de entrenados al nuevo cupo', () => {
    const s = newGame();
    const t = userWith(s);
    t.staff.trainers = 2;
    const field = t.squad.filter((p) => p.pos !== 'POR');
    for (const p of field) p.potential = p.rating + 5;
    for (const p of field.slice(0, 6)) toggleTraining(t, p.id);
    expect(t.training).toHaveLength(6);
    expect(fireStaff(t, 'trainers').ok).toBe(true);
    expect(t.training).toHaveLength(3);
  });

  it('probabilidad de mejorar: edad × intensidad × centro (HTML 609-626)', () => {
    expect(baseGrowthChance(18)).toBe(0.14);
    expect(baseGrowthChance(22)).toBe(0.09);
    expect(baseGrowthChance(25)).toBe(0.05);
    expect(baseGrowthChance(29)).toBe(0.02);
    expect(baseGrowthChance(33)).toBe(0);
    const s = newGame();
    const t = userWith(s);
    const [p] = trainees(t);
    expect(growthChance(t, p, 'normal')).toBeCloseTo(0.14);
    expect(growthChance(t, p, 'suave')).toBeCloseTo(0.14 * 0.6);
    expect(growthChance(t, p, 'intensa')).toBeCloseTo(0.14 * 1.6);
    t.trainingFacility = 5;
    expect(growthChance(t, p, 'intensa')).toBeCloseTo(0.14 * 1.6 * (1 + 5 * TRAINING.facilityGrowthPerLevel));
    p.age = 31;
    expect(growthChance(t, p, 'intensa')).toBe(0);
    p.age = 19;
    p.rating = p.potential;
    expect(growthChance(t, p, 'intensa')).toBe(0);
  });

  it('a más intensidad se mejora más, se cansa más y es determinista con la misma semilla', () => {
    const run = (intensity: 'suave' | 'intensa', seed: number) => {
      const s = newGame(40);
      const t = userWith(s);
      t.staff.doctors = 0;
      const ps = trainees(t);
      for (const p of ps) {
        t.training.push(p.id);
        setTrainingIntensity(t, p.id, intensity);
      }
      const rng = createRng(seed);
      let gains = 0;
      for (let i = 0; i < 25; i++) {
        for (const p of ps) {
          p.injury = null; // aislamos el progreso del riesgo de lesión
          p.fatigue = 0;
        }
        gains += processTraining(s, t, rng);
      }
      return { gains, fatigue: ps[0].fatigue, state: JSON.stringify(t.squad.map((p) => p.rating)) };
    };
    const soft = run('suave', 7), hard = run('intensa', 7);
    expect(hard.gains).toBeGreaterThan(soft.gains);
    expect(soft.fatigue).toBe(TRAINING.intensities.suave.fatigueCost);
    expect(hard.fatigue).toBe(TRAINING.intensities.intensa.fatigueCost);
    expect(run('intensa', 7)).toEqual(hard);
    expect(run('intensa', 8).state).not.toBe(hard.state);
  });

  it('una lesión en la práctica baja al jugador de la alineación y el médico la acorta; el único arquero no se lesiona', () => {
    const s = newGame();
    const t = userWith(s);
    const p = t.squad.find((x) => x.pos === 'CIE')!;
    p.rating = 50;
    p.potential = 80;
    t.training = [p.id];
    t.trainingIntensity[p.id] = 'intensa';
    t.lineup = t.squad.slice(0, 5).map((x) => x.id);
    t.lineup[1] = p.id;
    t.staff.doctors = 0;
    processTraining(s, t, lucky);
    expect(p.injury).not.toBeNull();
    expect(t.lineup).not.toContain(p.id);
    expect(s.news.some((n) => n.includes('se lesionó entrenando'))).toBe(true);

    const gk = t.squad.filter((x) => x.pos === 'POR');
    for (const g of gk.slice(1)) g.injury = { type: 'x', matchesLeft: 3 };
    gk[0].rating = 50;
    gk[0].potential = 80;
    t.training = [gk[0].id];
    processTraining(s, t, lucky);
    expect(gk[0].injury).toBeNull();
  });

  it('se procesa en cada fecha de liga y no en las rondas de copa', () => {
    const s = newGame(41);
    const t = userWith(s);
    const bench = t.squad.find((p) => !t.lineup.includes(p.id) && p.pos !== 'POR')!;
    bench.rating = 50;
    bench.potential = 80;
    bench.fatigue = 0;
    t.training = [bench.id];
    t.trainingIntensity[bench.id] = 'intensa';
    playNextStep(s); // fecha 1: descansa (0) y el entrenamiento suma 5
    expect(bench.fatigue).toBe(TRAINING.intensities.intensa.fatigueCost);
  });
});

describe('carrera del DT', () => {
  const countTies = (ties: Tie[], me: string) => ties.filter((t) => t.result && (t.home === me || t.away === me)).length;

  it('suma los partidos de liga, copa, playoffs, Internacional y Copa de Campeones; G+E+P = PJ y coincide con el club', () => {
    for (const seed of [3, 4]) {
      const s = newGame(seed);
      const me = s.userTeamId!;
      playSeason(s);
      const d = s.divisions.A;
      let expected = d.results.flat().filter((r) => r.homeId === me || r.awayId === me).length;
      expected += s.cup!.rounds.reduce((a, r) => a + countTies(r.ties, me), 0);
      expected += d.playoff ? d.playoff.rounds.reduce((a, r) => a + countTies(r.ties, me), 0) : 0;
      expected += s.championsCup ? s.championsCup.rounds.reduce((a, r) => a + countTies(r.ties, me), 0) : 0;
      const c = s.dt.career;
      expect(expected).toBeGreaterThan(34);
      expect(c.matches).toBe(expected);
      expect(c.wins + c.draws + c.losses).toBe(c.matches);
      const t = s.dt.tenures[0];
      expect({ m: t.matches, w: t.wins, d: t.draws, l: t.losses }).toEqual({ m: c.matches, w: c.wins, d: c.draws, l: c.losses });
    }
  });

  it('las temporadas completas se cuentan al cerrar y el DT envejece un año', () => {
    const s = newGame();
    playSeason(s);
    expect(s.dt.career.seasons).toBe(0);
    startNewSeason(s);
    expect(s.dt.career.seasons).toBe(1);
    expect(s.dt.age).toBe(46);
    expect(s.seasonHistory[0]).toMatchObject({ teamId: s.dt.tenures[0].teamId });
  });

  it('nombre (máx 24, vacío = DT) y edad (25 a 80)', () => {
    const s = newGame();
    renameDt(s, '  ' + 'x'.repeat(40) + '  ');
    expect(s.dtName).toHaveLength(DT_NAME_MAX);
    renameDt(s, '   ');
    expect(s.dtName).toBe('DT');
    setDtAge(s, 10);
    expect(s.dt.age).toBe(25);
    setDtAge(s, 99);
    expect(s.dt.age).toBe(80);
  });
});

describe('directiva y despido', () => {
  /** Partida al final de la temporada con el usuario flojísimo y 2 objetivos ya fallados con su club. */
  function toDismissal(seed = 60): { s: GameState; old: Team } {
    const s = newGame(seed);
    const old = userWith(s);
    for (const p of old.squad) {
      p.rating = 35;
      p.potential = 35;
    }
    s.objective = { division: 'A', season: 1, tier: 'top', type: 'promote', text: 'x' }; // en A solo lo cumpliría un campeón de playoffs
    s.seasonHistory = [
      { teamId: old.id, teamName: old.name, season: -1, division: 'A', position: 15, outcome: '', objective: null, objectiveMet: false },
      { teamId: old.id, teamName: old.name, season: 0, division: 'A', position: 15, outcome: '', objective: null, objectiveMet: false },
    ];
    s.dt.tenures[0].fromSeason = -1; // lleva dirigiendo desde antes de esas dos temporadas
    expect(failureStreak(s)).toBe(2);
    expect(boardPressure(s).level).toBe('ultimatum');
    playSeason(s);
    return { s, old };
  }

  it('el aviso de la directiva escala con la racha: 1 impaciente, 2 ultimátum, 3 despido', () => {
    const s = newGame();
    const me = s.userTeamId!;
    const rec = (met: boolean | null) => ({ teamId: me, season: 1, division: 'A' as const, position: 9, outcome: '', objective: null, objectiveMet: met });
    expect(boardPressure(s).level).toBe('none');
    s.seasonHistory.push(rec(false));
    expect(boardPressure(s)).toMatchObject({ streak: 1, level: 'impatient' });
    s.seasonHistory.push(rec(false));
    expect(boardPressure(s)).toMatchObject({ streak: 2, level: 'ultimatum' });
    s.seasonHistory.push(rec(false));
    expect(shouldFire(s)).toBe(true);
    s.seasonHistory.push(rec(true)); // cumplir corta la racha
    expect(failureStreak(s)).toBe(0);
    // la racha es por club: los fallos con otro club no cuentan
    s.seasonHistory = [{ ...rec(false), teamId: 'otro' }, { ...rec(false), teamId: 'otro' }, { ...rec(false), teamId: 'otro' }];
    expect(shouldFire(s)).toBe(false);
  });

  it('a la 3.ª temporada sin objetivo: queda libre con 3 ofertas, sin ids colgados y el club pasa a la computadora', () => {
    const { s, old } = toDismissal();
    startNewSeason(s);
    expect(s.userTeamId).toBeNull();
    expect(s.userDivision).toBeNull();
    expect(s.dt.unemployed).toBe(true);
    expect(s.dt.fired).toMatchObject({ clubId: old.id, club: old.name, season: 1 });
    expect(s.objective).toBeNull();
    expect(s.sponsorOffers).toBeNull();
    expect(s.market.offers).toEqual([]);
    expect(s.dt.tenures[0].toSeason).toBe(1);
    expect(s.dt.jobOffers).toHaveLength(3);
    expect(s.dt.jobOffers.some((o) => o.teamId === old.id)).toBe(false);
    expect(s.news.some((n) => n.includes('decidió separarte'))).toBe(true);
    // el club anterior sigue en el mundo, sin marcas del usuario y con sponsor firmado por la computadora
    const ex = allTeams(s).find((t) => t.id === old.id)!;
    expect(ex).toBeDefined();
    expect(ex.squad.some((p) => p.transferListed)).toBe(false);
    expect(ex.finance.sponsor.season).toBe(s.season);
    expect(ex.lineup.every((id) => id === null || ex.squad.some((p) => p.id === id))).toBe(true);
    // ningún id colgado
    const ids = new Set(allTeams(s).map((t) => t.id));
    for (const o of s.dt.jobOffers) expect(ids.has(o.teamId)).toBe(true);
    for (const o of s.market.offers) expect(ids.has(o.teamId)).toBe(true);
    for (const w of s.watchlist) expect(ids.has(w.teamId)).toBe(true);
    expect(userNextFixture(s)).toBeNull();
    // el mundo sigue andando sin usuario
    playSeason(s);
    expect(isSeasonOver(s)).toBe(true);
  });

  it('elegir una oferta: nuevo club, división, objetivo y estado limpio; la temporada se juega normal', () => {
    const { s, old } = toDismissal(61);
    startNewSeason(s);
    const pick = s.dt.jobOffers[1].teamId;
    const div = teamDivision(s, pick)!;
    const watched = allTeams(s).find((t) => t.id === pick)!.squad[0];
    expect(toggleWatch(s, watched.id).ok).toBe(true);
    expect(acceptJobOffer(s, 'no-existe')).toMatchObject({ ok: false });
    expect(acceptJobOffer(s, pick)).toEqual({ ok: true, cost: 0 });
    expect(s.userTeamId).toBe(pick);
    expect(s.userDivision).toBe(div);
    expect(s.dt.unemployed).toBe(false);
    expect(s.dt.jobOffers).toEqual([]);
    expect(s.objective?.division).toBe(div);
    expect(s.watchlist.some((w) => w.playerId === watched.id)).toBe(false); // ya es de su club
    expect(s.dt.tenures).toHaveLength(2);
    expect(s.dt.tenures[1]).toMatchObject({ teamId: pick, toSeason: null });
    expect(s.dt.tenures[0].teamId).toBe(old.id);
    expect(failureStreak(s)).toBe(0); // la presión se reinicia con el club nuevo
    expect(userNextFixture(s)).not.toBeNull();
    playSeason(s);
    expect(s.dt.career.matches).toBeGreaterThan(34);
  });

  it('esperar sin club: pasa el tiempo y siempre queda al menos una oferta', () => {
    const { s } = toDismissal(62);
    startNewSeason(s);
    s.dt.jobOffers = [];
    for (let i = 0; i < 6; i++) {
      expect(waitForOffers(s)).toBe(true);
      expect(s.dt.jobOffers.length).toBeGreaterThan(0);
      expect(s.dt.jobOffers.length).toBeLessThanOrEqual(3);
    }
    expect(s.preseasonWeeksLeft).toBe(0); // la pretemporada pasó y ya se jugaron fechas
    expect(s.divisions.A.matchday).toBeGreaterThan(0);
    expect(waitForOffers(newGame())).toBe(false); // con club no hace nada
  });
});

describe('ofertas de trabajo con club', () => {
  it('llegan según reputación, hasta 2 abiertas, nunca del propio club y una sola tirada por fecha', () => {
    const s = newGame();
    const me = s.userTeamId!;
    s.dt.career = { matches: 100, wins: 80, draws: 10, losses: 10, seasons: 3 };
    s.titles = [{ season: 1, competition: 'divA' }, { season: 2, competition: 'copa' }, { season: 3, competition: 'divA' }];
    rollJobOffers(s, lucky);
    expect(s.dt.jobOffers).toHaveLength(1);
    expect(s.dt.jobOffers[0].teamId).not.toBe(me);
    rollJobOffers(s, lucky); // mismo día: no tira de nuevo
    expect(s.dt.jobOffers).toHaveLength(1);
    s.divisions.A.matchday = 1;
    rollJobOffers(s, lucky);
    expect(s.dt.jobOffers).toHaveLength(2);
    s.divisions.A.matchday = 2;
    rollJobOffers(s, lucky);
    expect(s.dt.jobOffers).toHaveLength(2); // tope de 2 abiertas
    expect(new Set(s.dt.jobOffers.map((o) => o.teamId)).size).toBe(2);
    expect(s.news.filter((n) => n.includes('te ofreció dirigirlos'))).toHaveLength(2);
  });

  it('un DT sin antecedentes en C no recibe ofertas de A; con títulos sí puede mirar más arriba', () => {
    const s = createNewGame(70, 'DT');
    s.userDivision = 'C';
    s.userTeamId = s.divisions.C.teams[0].id;
    openTenure(s);
    const inDivs = () => new Set(s.dt.jobOffers.map((o) => teamDivision(s, o.teamId)));
    for (let i = 0; i < 20; i++) {
      s.divisions.C.matchday = i;
      s.dt.jobOffers = [];
      rollJobOffers(s, lucky);
      expect([...inDivs()]).toEqual(['C']);
    }
    s.titles = Array.from({ length: 5 }, (_, i) => ({ season: i + 1, competition: 'divC' as const }));
    let top = false;
    for (let i = 0; i < 30 && !top; i++) {
      s.divisions.C.matchday = i;
      s.dt.jobOffers = [];
      rollJobOffers(s, createRng(i + 1));
      s.dt.jobOffers.forEach((o) => (top ||= teamDivision(s, o.teamId) !== 'C'));
    }
    expect(top).toBe(true);
  });

  it('aceptar con club: deja el anterior a la computadora y limpia ofertas de mercado, sponsor, transferibles y cartera', () => {
    const s = newGame(71);
    const old = userWith(s);
    const target = s.divisions.B.teams[3];
    old.squad[0].transferListed = true;
    s.market.offers = [{ playerId: old.squad[0].id, teamId: s.divisions.A.teams[1].id, price: 1000 }];
    s.sponsorOffers = { season: 1, offers: [{ name: 'x', perMatch: 1, bonus: 0 }] };
    toggleWatch(s, target.squad[0].id);
    s.dt.jobOffers = [{ teamId: target.id, season: 1 }];
    s.divisions.A.matchday = 4; // a mitad de temporada
    expect(acceptJobOffer(s, target.id).ok).toBe(true);
    expect(s.userTeamId).toBe(target.id);
    expect(s.userDivision).toBe('B');
    expect(old.squad.some((p) => p.transferListed)).toBe(false);
    expect(s.market.offers.some((o) => o.playerId === old.squad[0].id)).toBe(false);
    expect(s.sponsorOffers === null || s.sponsorOffers.offers.every((o) => o.name !== 'x')).toBe(true);
    expect(s.watchlist.some((w) => target.squad.some((p) => p.id === w.playerId))).toBe(false);
    expect(s.dt.tenures.map((t) => [t.teamId, t.toSeason])).toEqual([[old.id, 1], [target.id, null]]);
    expect(old.lineup.every(Boolean)).toBe(true);
    // el club anterior ya no es del usuario: puede ser fichado y la computadora lo maneja
    playSeason(s);
    expect(isSeasonOver(s)).toBe(true);
  });
});

describe('migración 5 → 6', () => {
  /** Una partida v5 "de verdad": sin ninguno de los campos de este bloque. */
  function v5(): Record<string, unknown> {
    const s = newGame(80);
    playNextStep(s);
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.version = 5;
    delete raw.dt;
    for (const d of ['A', 'B', 'C']) {
      for (const t of (raw.divisions as Record<string, { teams: Record<string, unknown>[] }>)[d].teams) {
        for (const k of ['academy', 'academyFacility', 'trainingFacility', 'training', 'trainingIntensity']) delete t[k];
      }
    }
    return raw;
  }

  it('completa cantera, centros, entrenamiento y perfil del DT, de forma determinista, y la partida sigue', () => {
    expect(CURRENT_SAVE_VERSION).toBe(6);
    const a = parseSave(v5())!, b = parseSave(v5())!;
    expect(a).not.toBeNull();
    expect(a.version).toBe(6);
    expect(a).toEqual(b);
    for (const t of allTeams(a)) {
      expect(t.academy).toHaveLength(12);
      expect(t.academyFacility).toBe(0);
      expect(t.trainingFacility).toBe(0);
      expect(t.training).toEqual([]);
      expect(t.trainingIntensity).toEqual({});
    }
    expect(a.dt.unemployed).toBe(false);
    expect(a.dt.age).toBe(45);
    expect(a.dt.tenures).toHaveLength(1);
    expect(a.dt.tenures[0]).toMatchObject({ teamId: a.userTeamId, toSeason: null });
    expect(a.dt.career.matches).toBe(0);
    // sigue andando, incluida la temporada siguiente
    playSeason(a);
    startNewSeason(a);
    expect(a.season).toBe(2);
    for (const t of allTeams(a)) expect(t.academy).toHaveLength(12);
  });

  it('el id de los juveniles migrados no se repite con el de ningún jugador', () => {
    const a = parseSave(v5())!;
    const ids = allTeams(a).flatMap((t) => [...t.squad, ...t.academy].map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('varias temporadas con cantera, entrenamiento y ofertas', () => {
  it('6 temporadas sin errores; si despiden al DT se acepta la primera oferta y se sigue', () => {
    const s = newGame(90);
    let fired = 0;
    for (let year = 1; year <= 6; year++) {
      const t = userTeam(s);
      if (t) {
        t.budget = Math.max(t.budget, 80_000);
        if (t.trainingFacility < 2) upgradeTrainingFacility(t, ctx);
        const cand = t.squad.filter((p) => p.pos !== 'POR' && p.rating < p.potential).slice(0, trainingCap(t));
        t.training = [];
        for (const p of cand) toggleTraining(t, p.id);
      }
      playSeason(s);
      expect(isSeasonOver(s)).toBe(true);
      startNewSeason(s);
      if (s.dt.unemployed) {
        fired++;
        expect(s.userTeamId).toBeNull();
        expect(acceptJobOffer(s, s.dt.jobOffers[0].teamId).ok).toBe(true);
      }
      const all = allTeams(s);
      expect(new Set(all.map((x) => x.id)).size).toBe(54);
      const ids = all.flatMap((x) => [...x.squad, ...x.academy].map((p) => p.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const x of all) {
        expect(x.squad.length).toBeLessThanOrEqual(SQUAD.max);
        expect(x.academy).toHaveLength(12);
        for (const id of x.training) expect(x.squad.some((p) => p.id === id)).toBe(true);
      }
      expect(s.news.length).toBeLessThanOrEqual(30);
    }
    expect(s.season).toBe(7);
    expect(s.dt.age).toBe(51);
    expect(fired).toBeGreaterThanOrEqual(0);
  });
});

describe('clubes condenados al descenso de C', () => {
  it('no se puede aceptar la oferta de un club que ya descendió de C y va a desaparecer', () => {
    const s = newGame(77);
    const doomed = s.divisions.C.teams[17];
    s.divisions.C.relegated = [doomed.id];
    s.dt.jobOffers = [{ teamId: doomed.id, season: s.season }];
    expect(isDoomedClub(s, doomed.id)).toBe(true);
    expect(openJobOffers(s)).toHaveLength(0);
    const res = acceptJobOffer(s, doomed.id);
    expect(res.ok).toBe(false);
    expect(s.userTeamId).toBe(s.divisions.A.teams[0].id);
  });

  it('tras varias temporadas el usuario siempre dirige un club existente y ningún plantel pasa de 20', () => {
    const s = newGame(3);
    for (let season = 0; season < 6; season++) {
      playSeason(s);
      // Si hay ofertas, el DT acepta la primera vigente (incluye el caso de clubes de C ya descendidos).
      const offer = openJobOffers(s)[0];
      if (offer) acceptJobOffer(s, offer.teamId);
      startNewSeason(s);
      if (s.dt.unemployed) {
        for (let g = 0; g < 10 && s.dt.unemployed; g++) {
          const o = openJobOffers(s)[0];
          if (o) acceptJobOffer(s, o.teamId);
          else waitForOffers(s);
        }
      }
      if (s.userTeamId) {
        expect(userTeam(s)).toBeDefined();
        expect(teamDivision(s, s.userTeamId)).toBe(s.userDivision);
      }
      for (const t of allTeams(s)) expect(t.squad.length).toBeLessThanOrEqual(SQUAD.max);
    }
  });
});
