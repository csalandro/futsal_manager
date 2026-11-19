import { describe, expect, it } from 'vitest';
import type { Player, Position, Team } from '../domain/types';
import { createFinance, defaultStaff } from './finance';
import { expectedGoals, penaltyShootout, simulateMatch, winnerId } from './match';
import { outcomeProbabilities, samplePoisson } from './poisson';
import { createRng } from './rng';

function player(id: string, pos: Position, rating: number): Player {
  return {
    id, name: `J${id}`, pos, rating, potential: rating, age: 25, form: 0, fatigue: 0, value: 0,
    contractYears: 2, foot: 'D', number: 1, origin: '', trait: '', injuryProneness: 1,
    peakStart: 27, peakEnd: 30, stats: { goals: 0, assists: 0, gamesPlayed: 0, yellowCards: 0, redCards: 0 },
    injury: null, suspension: 0, yellowAccum: 0,
  };
}

function team(id: string, rating: number): Team {
  const squad = (['POR', 'CIE', 'ALA', 'ALA', 'PIV'] as Position[]).map((pos, i) => player(`${id}${i}`, pos, rating));
  return {
    id, name: id, color: '#fff', squad, lineup: squad.map((p) => p.id),
    tactic: { formation: '2-2', press: 'media', style: 'equilibrado' }, morale: 50, budget: 0,
    stadium: { name: '', capacity: 0 }, record: { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }, penaltyTakers: [],
    finance: createFinance('A', 1000), staff: defaultStaff(), academy: [], academyFacility: 0, trainingFacility: 0, training: [], trainingIntensity: {},
  };
}

describe('poisson', () => {
  it('la media muestral se acerca a λ', () => {
    const rng = createRng(1);
    const n = 50_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += samplePoisson(2.8, rng);
    expect(sum / n).toBeCloseTo(2.8, 1);
  });

  it('las probabilidades exactas suman 1', () => {
    const p = outcomeProbabilities(3, 2.5);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 6);
  });
});

describe('motor de partido', () => {
  it('es determinista con la misma semilla', () => {
    const a = simulateMatch(team('A', 60), team('B', 60), createRng(42));
    const b = simulateMatch(team('A', 60), team('B', 60), createRng(42));
    expect(a).toEqual(b);
  });

  it('los goles del relato coinciden con el resultado', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const { result, events } = simulateMatch(team('A', 65), team('B', 55), rng);
      expect(events.filter((e) => e.type === 'goal' && e.side === 'home')).toHaveLength(result.hg);
      expect(events.filter((e) => e.type === 'goal' && e.side === 'away')).toHaveLength(result.ag);
    }
  });

  it('calibración: equipos parejos ≈ 5-6 goles por partido y ventaja local', () => {
    const rng = createRng(123);
    const n = 20_000;
    let goals = 0, homeWins = 0, awayWins = 0;
    const h = team('H', 60), a = team('A', 60);
    for (let i = 0; i < n; i++) {
      const { result } = simulateMatch(h, a, rng);
      goals += result.hg + result.ag;
      if (result.hg > result.ag) homeWins++;
      else if (result.ag > result.hg) awayWins++;
    }
    expect(goals / n).toBeGreaterThan(5);
    expect(goals / n).toBeLessThan(6.5);
    expect(homeWins).toBeGreaterThan(awayWins);
  });

  it('el equipo más fuerte gana la mayoría', () => {
    const rng = createRng(9);
    let strongWins = 0;
    for (let i = 0; i < 5_000; i++) {
      const { result } = simulateMatch(team('F', 75), team('D', 55), rng, { neutral: true });
      if (result.hg > result.ag) strongWins++;
    }
    expect(strongWins / 5_000).toBeGreaterThan(0.6);
  });

  it('λ crece con la diferencia de fuerza', () => {
    const even = expectedGoals(60, 60, 1, true);
    const fav = expectedGoals(70, 60, 1, true);
    expect(even.home).toBeCloseTo(even.away);
    expect(fav.home).toBeGreaterThan(even.home);
    expect(fav.away).toBeLessThan(even.away);
  });

  it('en eliminatoria siempre hay ganador', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const { result } = simulateMatch(team('A', 60), team('B', 60), rng, { knockout: true });
      expect(winnerId(result)).not.toBeNull();
    }
  });

  it('los penales nunca terminan empatados', () => {
    const rng = createRng(11);
    for (let i = 0; i < 500; i++) {
      const p = penaltyShootout(team('A', 60), team('B', 60), rng);
      expect(p.home).not.toBe(p.away);
    }
  });
});
