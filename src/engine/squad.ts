// Disponibilidad, alineación automática, contratos y gestión del plantel.
// Las funciones que reciben un Team lo MUTAN (se llaman dentro de immer).
import type { Player, Team } from '../domain/types';
import { FATIGUE_BLOCK, SQUAD } from './config';
import { playerValue } from './generate';
import type { Rng } from './rng';
import { getFullSlots } from './strength';

/** Motivo por el que un jugador no puede jugar, o null si está disponible. */
export function unavailableReason(p: Player): string | null {
  if (p.injury) return `Lesionado (${p.injury.matchesLeft} ${p.injury.matchesLeft === 1 ? 'fecha' : 'fechas'})`;
  if (p.suspension > 0) return `Suspendido (${p.suspension} ${p.suspension === 1 ? 'partido' : 'partidos'})`;
  // HTML 776-802: FATIGUE_BLOCK, un jugador muy cansado no puede ser titular.
  if (p.fatigue >= FATIGUE_BLOCK) return `Fatiga bloqueada (${Math.round(p.fatigue)}%)`;
  return null;
}

export function isAvailable(p: Player): boolean {
  return unavailableReason(p) === null;
}

/** Arqueros que podrían jugar, sin contar a `excludeId` (HTML availableGkCount, 663-667). */
export function availableGkCount(team: Team, excludeId?: string): number {
  return team.squad.filter((p) => p.pos === 'POR' && p.id !== excludeId && !p.injury && p.suspension <= 0).length;
}

/**
 * [arquero, 4 de campo] con los mejores disponibles, respetando los puestos de la formación cuando se puede.
 * Si no alcanzan los disponibles, completa con los menos malos (sin lesión/suspensión primero).
 */
export function bestAvailableFive(team: Team): (string | null)[] {
  const slots = getFullSlots(team.tactic.formation);
  const used = new Set<string>();
  const out: (string | null)[] = Array(slots.length).fill(null);
  const byRating = (a: Player, b: Player) => b.rating - a.rating;
  const pool = team.squad.filter(isAvailable).sort(byRating);

  const take = (i: number, pred: (p: Player) => boolean, from: Player[]) => {
    const p = from.find((x) => !used.has(x.id) && pred(x));
    if (p) {
      out[i] = p.id;
      used.add(p.id);
    }
  };

  // 1) puestos con posición exigida (arquero primero), 2) puestos libres con el resto de campo.
  slots.forEach((req, i) => req && take(i, (p) => p.pos === req, pool));
  slots.forEach((req, i) => !req && take(i, (p) => p.pos !== 'POR', pool));
  // Faltantes: algún jugador de campo disponible en un puesto exigido de otra posición.
  slots.forEach((_, i) => out[i] === null && i > 0 && take(i, (p) => p.pos !== 'POR', pool));
  // Todavía vacío: lo que haya (primero los no lesionados/suspendidos, menos cansados).
  const rank = (p: Player) => (p.injury ? 2 : p.suspension > 0 ? 1 : 0);
  const rest = team.squad
    .filter((p) => !used.has(p.id))
    .sort((a, b) => rank(a) - rank(b) || a.fatigue - b.fatigue || b.rating - a.rating);
  slots.forEach((_, i) => out[i] === null && take(i, () => true, rest));
  return out;
}

/** Problemas de la alineación del usuario, en español. Vacío = se puede jugar. */
export function lineupIssues(team: Team): string[] {
  const issues: string[] = [];
  const slots = getFullSlots(team.tactic.formation);
  const byId = new Map(team.squad.map((p) => [p.id, p]));
  const seen = new Set<string>();
  slots.forEach((_, i) => {
    const id = team.lineup[i] ?? null;
    const p = id ? byId.get(id) : undefined;
    if (!p) {
      issues.push(i === 0 ? 'Falta el arquero.' : `Puesto ${i} vacío.`);
      return;
    }
    if (seen.has(p.id)) issues.push(`${p.name} está repetido en la alineación.`);
    seen.add(p.id);
    const why = unavailableReason(p);
    if (why) issues.push(`${p.name}: ${why.toLowerCase()}.`);
  });
  const gk = team.lineup[0] ? byId.get(team.lineup[0]) : undefined;
  if (gk && gk.pos !== 'POR') issues.push('No hay un arquero en la alineación.');
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Contratos y plantel (HTML 318-367)
// ---------------------------------------------------------------------------------------------

export type ActionResult = { ok: true; cost: number; added?: number } | { ok: false; reason: string };

/** Costo de renovar: 25% del valor (HTML 360). */
export function renewCost(p: Player): number {
  return Math.round((playerValue(p.rating) * SQUAD.renewCostShare) / 100) * 100;
}

/** Indemnización por despido (HTML 329-332). */
export function severanceCost(p: Player): number {
  const years = Math.max(1, p.contractYears);
  return Math.round((playerValue(p.rating) * (0.1 + 0.05 * years)) / 100) * 100;
}

/** Suma 2-3 años de contrato (máx SQUAD.maxContractYears) y descuenta el costo del presupuesto (HTML 355-367). */
export function renewContract(team: Team, playerId: string, rng: Rng): ActionResult {
  const p = team.squad.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El jugador no está en el plantel.' };
  if (p.contractYears >= SQUAD.maxContractYears) return { ok: false, reason: 'Ya tiene el contrato máximo.' };
  const cost = renewCost(p);
  if (team.budget < cost) return { ok: false, reason: 'No alcanza el presupuesto.' };
  const added = Math.min(rng.int(2, 3), SQUAD.maxContractYears - p.contractYears);
  team.budget -= cost;
  p.contractYears += added;
  return { ok: true, cost, added };
}

/** Motivo por el que no se puede despedir, o null (HTML 343-348). */
export function fireBlocker(team: Team, p: Player): string | null {
  if (team.squad.length <= SQUAD.minAfterFire) return `El plantel mínimo es de ${SQUAD.minAfterFire} jugadores.`;
  if (p.pos === 'POR' && availableGkCount(team, p.id) === 0) return 'Es el único arquero disponible.';
  if (team.budget < severanceCost(p)) return 'No alcanza el presupuesto para la indemnización.';
  return null;
}

export function removeFromTeam(team: Team, playerId: string): void {
  team.squad = team.squad.filter((x) => x.id !== playerId);
  team.lineup = team.lineup.map((id) => (id === playerId ? null : id));
  team.penaltyTakers = team.penaltyTakers.filter((id) => id !== playerId);
}

export function firePlayer(team: Team, playerId: string): ActionResult {
  const p = team.squad.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El jugador no está en el plantel.' };
  const why = fireBlocker(team, p);
  if (why) return { ok: false, reason: why };
  const cost = severanceCost(p);
  team.budget -= cost;
  removeFromTeam(team, playerId);
  return { ok: true, cost };
}

export function canAddPlayer(team: Team): boolean {
  return team.squad.length < SQUAD.max;
}

/** Número de camiseta 1..99, único en el plantel (HTML 321-327). */
export function setPlayerNumber(team: Team, playerId: string, n: number): { ok: true } | { ok: false; reason: string } {
  const p = team.squad.find((x) => x.id === playerId);
  if (!p) return { ok: false, reason: 'El jugador no está en el plantel.' };
  const num = Math.round(n);
  if (!Number.isFinite(num) || num < 1 || num > 99) return { ok: false, reason: 'El número tiene que ir de 1 a 99.' };
  if (team.squad.some((x) => x.id !== playerId && x.number === num)) return { ok: false, reason: `El ${num} ya lo tiene otro jugador.` };
  p.number = num;
  return { ok: true };
}

/** Agrega o quita un pateador (máx 5), HTML 665-671. */
export function togglePenaltyTaker(team: Team, playerId: string): void {
  const i = team.penaltyTakers.indexOf(playerId);
  if (i >= 0) team.penaltyTakers.splice(i, 1);
  else if (team.penaltyTakers.length < 5 && team.squad.some((p) => p.id === playerId)) team.penaltyTakers.push(playerId);
}

/** Sube (-1) o baja (+1) a un pateador en el orden. */
export function movePenaltyTaker(team: Team, playerId: string, dir: -1 | 1): void {
  const i = team.penaltyTakers.indexOf(playerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= team.penaltyTakers.length) return;
  [team.penaltyTakers[i], team.penaltyTakers[j]] = [team.penaltyTakers[j], team.penaltyTakers[i]];
}
