// Cantera: juveniles de 15 a 18 años, promoción, venta y mejora del centro juvenil. Port de HTML 411-471 (generación,
// envejecimiento anual y puntaje de desarrollo) y 3094-3178 (pantalla de la cantera).
// Las funciones que reciben Team/GameState los MUTAN (se llaman dentro de immer).
import type { GameState, Player, Team } from '../domain/types';
import { SQUAD, YOUTH } from './config';
import { canSpend, charge, LOCKOUT_REASON, recordMovement, type FinanceCtx } from './finance';
import { generateAcademyPlayer, peakStartFromScore, playerValue } from './generate';
import type { Rng } from './rng';
import { assignFreeNumber, canAddPlayer, dropFromTraining, sellBlocker, type ActionResult } from './squad';
import { pushNews, teamDivision } from './world';

// ---------------------------------------------------------------------------------------------
// Desarrollo
// ---------------------------------------------------------------------------------------------

/** HTML 436-440: 0,15 + 0,12 por nivel del centro + 0,25 con entrenador de juveniles (0 a 1). */
export function developmentScore(team: Team): number {
  const hasCoach = team.staff.youthCoaches > 0;
  const s = YOUTH.devBase + team.academyFacility * YOUTH.devPerFacility + (hasCoach ? YOUTH.devYouthCoach : 0);
  return Math.max(0, Math.min(1, s));
}

/** HTML 441-445: al subir al primer equipo se fija desde qué edad llega a su pico. */
export function lockInPeak(team: Team, p: Player): void {
  p.peakStart = peakStartFromScore(developmentScore(team));
  p.peakEnd = 30;
}

/** HTML 3118: se vende por el 50% de su valor. */
export function youthSellPrice(p: Player): number {
  return Math.round((p.value * YOUTH.sellShare) / 100) * 100;
}

function intoSquad(team: Team, p: Player, rng: Rng): void {
  lockInPeak(team, p);
  p.contractYears = rng.int(YOUTH.contractYears[0], YOUTH.contractYears[1]);
  p.value = playerValue(p.rating);
  assignFreeNumber(team, p, rng);
  team.squad.push(p);
}

/**
 * Cierre de año de la cantera de UN equipo (HTML 446-471): todos cumplen un año; los que llegan a 19 se promueven
 * obligatoriamente (si el plantel ya tiene 20 quedan libres), los demás crecen según el centro y el entrenador de
 * juveniles y entran 3 chicos de 15 (con mejor calidad por ojeador). Devuelve los jugadores que subieron.
 * Las noticias son solo para el usuario.
 */
export function ageAcademy(state: GameState, team: Team, isUser: boolean, rng: Rng): Player[] {
  const promoted: Player[] = [];
  for (const p of team.academy) p.age++;
  const leaving = team.academy.filter((p) => p.age >= YOUTH.promoteAge);
  team.academy = team.academy.filter((p) => p.age < YOUTH.promoteAge);
  for (const p of leaving) {
    // Si el plantel no tiene arquero se reserva un lugar: después se agrega uno obligatorio y no debe pasar de 20.
    const needsGkSlot = p.pos !== 'POR' && !team.squad.some((x) => x.pos === 'POR');
    if (canAddPlayer(team) && (!needsGkSlot || team.squad.length < SQUAD.max - 1)) {
      intoSquad(team, p, rng);
      promoted.push(p);
      if (isUser) pushNews(state, `⬆️ ${p.name} (${YOUTH.promoteAge} años) fue promovido obligatoriamente al primer equipo.`);
    } else if (isUser) {
      pushNews(state, `⚠️ ${p.name} cumplió ${YOUTH.promoteAge} años pero el plantel ya tenía ${SQUAD.max} jugadores y quedó libre.`);
    }
  }
  const bonus = Math.floor(team.academyFacility / YOUTH.growthFacilityDiv) + (team.staff.youthCoaches > 0 ? YOUTH.growthYouthCoach : 0);
  for (const p of team.academy) {
    if (p.rating >= p.potential) continue;
    p.rating = Math.min(p.potential, p.rating + rng.int(YOUTH.growth[0], YOUTH.growth[1]) + bonus);
    p.value = playerValue(p.rating);
  }
  const division = teamDivision(state, team.id) ?? 'C';
  const fresh: Player[] = [];
  for (let i = 0; i < YOUTH.intake; i++) {
    fresh.push(generateAcademyPlayer(rng, team.staff.scouts, YOUTH.intakeAge, team.academyFacility, division));
  }
  team.academy.push(...fresh);
  if (isUser && team.staff.scouts > 0) {
    const best = [...fresh].sort((a, b) => b.potential - a.potential)[0];
    pushNews(state, `🔎 Llegaron ${fresh.length} chicos de ${YOUTH.intakeAge} años a la cantera; el de más proyección es ${best.name} (potencial ${best.potential}).`);
  } else if (isUser) {
    pushNews(state, `🌱 Llegaron ${fresh.length} chicos de ${YOUTH.intakeAge} años a la cantera.`);
  }
  return promoted;
}

// ---------------------------------------------------------------------------------------------
// Acciones del usuario (HTML 3094-3178)
// ---------------------------------------------------------------------------------------------

/** Subir a un juvenil al primer equipo antes de los 19 (HTML 3122-3131): solo si el plantel no está lleno. */
export function promoteYouth(team: Team, playerId: string, rng: Rng): ActionResult {
  const p = team.academy.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El juvenil no está en la cantera.' };
  if (!canAddPlayer(team)) return { ok: false, reason: `El plantel ya tiene ${SQUAD.max} jugadores.` };
  team.academy = team.academy.filter((x) => x.id !== playerId);
  intoSquad(team, p, rng);
  return { ok: true, cost: 0 };
}

/** "Bajar a juveniles" (HTML 3160-3166): un jugador de primera menor de 19 vuelve a la cantera. */
export function demoteToAcademy(team: Team, playerId: string): ActionResult {
  const p = team.squad.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El jugador no está en el plantel.' };
  if (p.age >= YOUTH.promoteAge) return { ok: false, reason: `Solo se puede bajar a menores de ${YOUTH.promoteAge} años.` };
  const why = sellBlocker(team, p);
  if (why) return { ok: false, reason: why };
  team.squad = team.squad.filter((x) => x.id !== playerId);
  team.lineup = team.lineup.map((id) => (id === playerId ? null : id));
  team.penaltyTakers = team.penaltyTakers.filter((id) => id !== playerId);
  dropFromTraining(team, playerId);
  delete p.transferListed;
  team.academy.push(p);
  return { ok: true, cost: 0 };
}

/** Vender un juvenil (HTML 3132-3139): cobra el 50% de su valor. `cost` viene negativo (es plata que entra). */
export function sellYouth(team: Team, playerId: string, ctx: FinanceCtx): ActionResult {
  const p = team.academy.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El juvenil no está en la cantera.' };
  const price = youthSellPrice(p);
  team.budget += price;
  recordMovement(team, ctx, 'ventas', price, `Venta del juvenil ${p.name}`);
  team.academy = team.academy.filter((x) => x.id !== playerId);
  return { ok: true, cost: -price };
}

/** HTML 3105: 6000 × (nivel + 1). */
export function academyFacilityCost(team: Team): number {
  return Math.round(YOUTH.facilityCost * (team.academyFacility + 1));
}

/** Mejora el centro juvenil un nivel (HTML 3106-3110): no con gastos restringidos, hasta el nivel 5. */
export function upgradeAcademy(team: Team, ctx: FinanceCtx): ActionResult {
  if (!canSpend(team)) return { ok: false, reason: LOCKOUT_REASON };
  if (team.academyFacility >= YOUTH.facilityMax) return { ok: false, reason: 'El centro juvenil ya está al máximo.' };
  const cost = academyFacilityCost(team);
  if (team.budget < cost) return { ok: false, reason: 'No alcanza el presupuesto.' };
  charge(team, ctx, 'instalaciones', cost, `Centro juvenil: nivel ${team.academyFacility + 1}`);
  team.academyFacility++;
  return { ok: true, cost };
}
