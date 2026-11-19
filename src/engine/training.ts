// Entrenamiento individual del usuario y centro de entrenamiento. Port de HTML 608-686 (reglas y procesamiento por
// fecha) y 3278-3334 (pantalla). Las funciones que reciben Team/GameState los MUTAN (se llaman dentro de immer).
import type { GameState, Player, Team, TrainingIntensity } from '../domain/types';
import { INJURY, TRAINING } from './config';
import { canSpend, charge, LOCKOUT_REASON, type FinanceCtx } from './finance';
import { pickInjuryType } from './match';
import type { Rng } from './rng';
import { availableGkCount, type ActionResult } from './squad';
import { pushNews } from './world';

export const INTENSITIES = Object.keys(TRAINING.intensities) as TrainingIntensity[];

/** Cupos de entrenamiento: 3 por preparador físico (HTML 608). */
export function trainingCap(team: Team): number {
  return Math.max(1, team.staff.trainers) * TRAINING.slotsPerTrainer;
}

/** Probabilidad base de mejorar +1 por fecha según la edad (HTML 609-615). */
export function baseGrowthChance(age: number): number {
  return TRAINING.growthByAge.find((x) => age <= x.maxAge)?.chance ?? 0;
}

export function intensityOf(team: Team, playerId: string): TrainingIntensity {
  return team.trainingIntensity[playerId] ?? 'normal';
}

/** HTML 625: +18% por nivel del centro. */
export function trainingFacilityMult(team: Team): number {
  return 1 + team.trainingFacility * TRAINING.facilityGrowthPerLevel;
}

/** HTML 626: -12% de riesgo de lesión por nivel, con piso de 0,4. */
export function trainingFacilityInjuryMult(team: Team): number {
  return Math.max(TRAINING.facilityInjuryFloor, 1 - team.trainingFacility * TRAINING.facilityInjuryPerLevel);
}

/** Probabilidad de mejorar +1 en una fecha: edad × intensidad × centro (HTML 3306). 0 si ya llegó a su potencial. */
export function growthChance(team: Team, p: Player, intensity: TrainingIntensity = intensityOf(team, p.id)): number {
  if (p.rating >= p.potential) return 0;
  return baseGrowthChance(p.age) * TRAINING.intensities[intensity].mult * trainingFacilityMult(team);
}

/** Pone o saca a un jugador del entrenamiento (HTML 677-686): hay cupos limitados y no entrena quien ya está al máximo. */
export function toggleTraining(team: Team, playerId: string): ActionResult {
  const p = team.squad.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El jugador no está en el plantel.' };
  if (team.training.includes(playerId)) {
    team.training = team.training.filter((id) => id !== playerId);
    return { ok: true, cost: 0 };
  }
  if (team.training.length >= trainingCap(team)) return { ok: false, reason: `No hay más cupos: tenés ${trainingCap(team)} (3 por preparador físico).` };
  if (p.rating >= p.potential) return { ok: false, reason: 'Ya llegó a su potencial: no mejora entrenando.' };
  team.training.push(playerId);
  return { ok: true, cost: 0 };
}

export function setTrainingIntensity(team: Team, playerId: string, intensity: TrainingIntensity): ActionResult {
  if (!TRAINING.intensities[intensity]) return { ok: false, reason: 'Esa intensidad no existe.' };
  if (!team.training.includes(playerId)) return { ok: false, reason: 'El jugador no está entrenando.' };
  if (intensity === 'normal') delete team.trainingIntensity[playerId];
  else team.trainingIntensity[playerId] = intensity;
  return { ok: true, cost: 0 };
}

/** HTML 627: 7000 × (nivel + 1). */
export function trainingFacilityCost(team: Team): number {
  return Math.round(TRAINING.facilityCost * (team.trainingFacility + 1));
}

/** Mejora el centro de entrenamiento un nivel (HTML 628-636): no con gastos restringidos, hasta el nivel 5. */
export function upgradeTrainingFacility(team: Team, ctx: FinanceCtx): ActionResult {
  if (!canSpend(team)) return { ok: false, reason: LOCKOUT_REASON };
  if (team.trainingFacility >= TRAINING.facilityMax) return { ok: false, reason: 'El centro de entrenamiento ya está al máximo.' };
  const cost = trainingFacilityCost(team);
  if (team.budget < cost) return { ok: false, reason: 'No alcanza el presupuesto.' };
  charge(team, ctx, 'instalaciones', cost, `Centro de entrenamiento: nivel ${team.trainingFacility + 1}`);
  team.trainingFacility++;
  return { ok: true, cost };
}

/**
 * Procesa una fecha de entrenamiento del usuario (HTML 637-676). Cada entrenado, salvo lesionados: suma el cansancio de la
 * intensidad, puede mejorar +1 (hasta su potencial) y puede lesionarse en la práctica (la lesión se acorta un 12% por
 * médico; el único arquero disponible no se lesiona). Devuelve cuántos mejoraron.
 */
export function processTraining(state: GameState, team: Team, rng: Rng): number {
  const facInj = trainingFacilityInjuryMult(team);
  let improved = 0;
  for (const id of [...team.training]) {
    const p = team.squad.find((x) => x.id === id);
    if (!p || p.injury) continue;
    const meta = TRAINING.intensities[intensityOf(team, id)];
    if (meta.fatigueCost > 0) p.fatigue = Math.min(100, p.fatigue + meta.fatigueCost);
    const chance = growthChance(team, p);
    if (chance > 0 && rng.chance(chance)) {
      p.rating = Math.min(p.potential, p.rating + 1);
      improved++;
      pushNews(state, `💪 ${p.name} mejoró entrenando: ahora tiene ${p.rating}${p.rating >= p.potential ? ' (llegó a su potencial)' : ''}.`);
    }
    if (meta.injuryChance > 0 && rng.chance(meta.injuryChance * facInj * p.injuryProneness) && !(p.pos === 'POR' && availableGkCount(team, p.id) === 0)) {
      const type = pickInjuryType(rng);
      const matchesLeft = Math.max(1, Math.round(rng.int(type.min, type.max) * (1 - team.staff.doctors * INJURY.medicalReduction)));
      p.injury = { type: type.name, matchesLeft };
      team.lineup = team.lineup.map((x) => (x === p.id ? null : x));
      pushNews(state, `🚑 ${p.name} se lesionó entrenando (${type.name}): vuelve en ${matchesLeft} fecha${matchesLeft === 1 ? '' : 's'}.`);
    }
  }
  return improved;
}
