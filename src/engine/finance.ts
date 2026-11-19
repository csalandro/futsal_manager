// Economía del club: asistencia, sueldos, sponsors, deuda, estadio y staff. Port de HTML 492-606 y 3844-3994.
// Las funciones que reciben Team/GameState los MUTAN (se llaman dentro de immer).
// Este módulo no importa season.ts ni generate.ts (para no armar ciclos): las noticias entran por callback.
import type {
  DivisionId, FinanceConcept, GameState, Player, SponsorOffer, StaffCounts, StaffKey, Team, TeamFinance,
} from '../domain/types';
import { ECONOMY, STADIUM_NAME_MAX, STADIUM_UPGRADES, STAFF, type StadiumUpgradeKey } from './config';
import { createRng, type Rng } from './rng';
import type { ActionResult } from './squad';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Cuándo ocurre un movimiento (para el historial). */
export interface FinanceCtx {
  season: number;
  matchday: number | null;
}

const num = (n: number) => n.toLocaleString('es-AR');

// ---------------------------------------------------------------------------------------------
// Valores iniciales (los usan generate.ts y la migración del guardado)
// ---------------------------------------------------------------------------------------------

export function defaultTicketPrice(div: DivisionId | null | undefined): number {
  return (div && ECONOMY.baseTicketPrice[div]) || ECONOMY.fallbackTicketPrice;
}

/** HTML 484: arranca con 1 preparador y nada más. */
export function defaultStaff(): StaffCounts {
  return { trainers: 1, medics: 0, doctors: 0, scouts: 0, youthCoaches: 0 };
}

export function createFinance(div: DivisionId, sponsorPerMatch: number): TeamFinance {
  return {
    ticketPrice: defaultTicketPrice(div),
    sponsor: { name: ECONOMY.startSponsor.name, perMatch: sponsorPerMatch, season: 0 },
    log: [],
    totals: { season: 0, byConcept: {} },
    debtStreak: 0,
    financialLockout: false,
  };
}

/** Auspiciante de origen a partir del nivel del plantel (para completar partidas viejas sin azar). */
export function sponsorFromRating(avgRating: number): number {
  const { min, max } = ECONOMY.startSponsor;
  return clamp(Math.round((avgRating * 20) / 10) * 10, min, max);
}

// ---------------------------------------------------------------------------------------------
// Movimientos e historial
// ---------------------------------------------------------------------------------------------

/** Registra un movimiento en el historial y en los totales de la temporada. NO toca el presupuesto. */
export function recordMovement(
  team: Team,
  ctx: FinanceCtx,
  concept: FinanceConcept,
  amount: number,
  label: string,
  limit: number = ECONOMY.logSizeUser,
): void {
  const f = team.finance;
  if (amount === 0) return;
  f.log.push({ season: ctx.season, matchday: ctx.matchday, concept, amount, label });
  if (f.log.length > limit) f.log.splice(0, f.log.length - limit);
  if (f.totals.season !== ctx.season) f.totals = { season: ctx.season, byConcept: {} };
  f.totals.byConcept[concept] = (f.totals.byConcept[concept] ?? 0) + amount;
}

/** Descuenta del presupuesto y lo deja en el historial. */
export function charge(team: Team, ctx: FinanceCtx, concept: FinanceConcept, cost: number, label: string): void {
  team.budget -= cost;
  recordMovement(team, ctx, concept, -cost, label);
}

/** ¿La directiva deja gastar? Falso con `financialLockout` (HTML 357, 600, 629, 4202). */
export function canSpend(team: Team): boolean {
  return !team.finance.financialLockout;
}

export const LOCKOUT_REASON = 'La directiva restringió los gastos: el presupuesto viene en rojo hace demasiado tiempo.';

// ---------------------------------------------------------------------------------------------
// Sueldos
// ---------------------------------------------------------------------------------------------

/** HTML 492-496. */
export function playerWage(p: Player): number {
  const base = Math.round((p.rating * p.rating * ECONOMY.wageFactor) / 100);
  const premium = p.rating > ECONOMY.wagePremiumFrom ? Math.round((p.rating - ECONOMY.wagePremiumFrom) * ECONOMY.wagePremiumPerPoint) : 0;
  return base + premium;
}

export function squadWages(team: Team): number {
  return team.squad.reduce((s, p) => s + playerWage(p), 0);
}

export function staffHeadcount(team: Team): number {
  return Object.values(team.staff).reduce((s, n) => s + n, 0);
}

export function staffWages(team: Team): number {
  return staffHeadcount(team) * ECONOMY.staffWage;
}

export function stadiumMaintenance(team: Team): number {
  return Math.round(team.stadium.capacity * ECONOMY.maintenancePerSeat);
}

/** Gasto fijo por fecha (sueldos + staff + mantenimiento). */
export function matchdayExpenses(team: Team): number {
  return squadWages(team) + staffWages(team) + stadiumMaintenance(team);
}

// ---------------------------------------------------------------------------------------------
// Asistencia e ingresos por partido (HTML 518-537, 563-592)
// ---------------------------------------------------------------------------------------------

/** Asistencia de un partido de local, topeada por la capacidad del estadio (HTML 520-532). */
export function computeAttendance(home: Team, division: DivisionId, rng: Rng, isRival = false): number {
  const a = ECONOMY.attendance;
  let rate = a.baseRate + rng.next() * a.randomRate;
  rate += (home.morale - a.moralePivot) / a.moraleDivisor;
  rate += a.divisionBonus[division] ?? 0;
  if (isRival) rate += a.rivalBonus;
  const basePrice = defaultTicketPrice(division);
  rate -= (home.finance.ticketPrice / basePrice - 1) * a.priceSensitivity;
  rate = clamp(rate, a.minRate, a.maxRate);
  return Math.round(home.stadium.capacity * rate);
}

/** Cambia el precio de la entrada dentro de los límites del original (HTML 534-537). */
export function setTicketPrice(team: Team, price: number): number {
  const p = clamp(Math.round(price) || ECONOMY.fallbackTicketPrice, ECONOMY.ticketMin, ECONOMY.ticketMax);
  team.finance.ticketPrice = p;
  return p;
}

export interface MatchdayFinance {
  season: number;
  /** Fecha de liga; null en copas y playoffs (el original los cobra igual: sponsor, sueldos y mantenimiento + entradas de local, HTML 563-592). */
  matchday: number | null;
  isHome: boolean;
  attendance: number;
  /** Texto del partido para el historial (HTML 565-566: label); por defecto "Fecha N". */
  label?: string;
}

/**
 * Cierra la fecha de UN equipo (HTML 563-592, ahora para todos): entradas (solo de local) + sponsor
 * − sueldos − staff − mantenimiento. Actualiza la racha de deuda y el lockout; `onNews` solo se pasa para el usuario.
 */
export function processClubFinances(
  team: Team,
  m: MatchdayFinance,
  isUser: boolean,
  onNews?: (text: string) => void,
): void {
  const ctx = { season: m.season, matchday: m.matchday };
  const limit = isUser ? ECONOMY.logSizeUser : ECONOMY.logSizeCpu;
  const day = m.label ?? `Fecha ${(m.matchday ?? 0) + 1}`;
  const gate = m.isHome ? m.attendance * team.finance.ticketPrice : 0;
  const entries: [FinanceConcept, number, string][] = [
    ['entradas', gate, `${day}: entradas (${num(m.attendance)} espectadores)`],
    ['sponsor', team.finance.sponsor.perMatch, `${day}: ${team.finance.sponsor.name}`],
    ['sueldos', -squadWages(team), `${day}: sueldos del plantel`],
    ['staff', -staffWages(team), `${day}: sueldos del staff`],
    ['mantenimiento', -stadiumMaintenance(team), `${day}: mantenimiento del estadio`],
  ];
  for (const [concept, amount, label] of entries) {
    team.budget += amount;
    recordMovement(team, ctx, concept, amount, label, limit);
  }

  const f = team.finance;
  if (team.budget < 0) {
    f.debtStreak++;
    if (f.debtStreak >= ECONOMY.lockoutThreshold && !f.financialLockout) {
      f.financialLockout = true;
      onNews?.(
        '🔒 La directiva te restringió los gastos: el presupuesto viene en rojo hace demasiado tiempo. No vas a poder renovar contratos, contratar empleados ni ampliar el estadio hasta salir de la deuda.',
      );
    }
  } else {
    if (f.financialLockout) onNews?.('🔓 Recuperaste el presupuesto: la directiva te vuelve a autorizar gastos.');
    f.debtStreak = 0;
    f.financialLockout = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Sponsors (HTML 538-561)
// ---------------------------------------------------------------------------------------------

function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Tres ofertas según el nivel del plantel (HTML 542-549). */
export function generateSponsorOffers(team: Team, rng: Rng): SponsorOffer[] {
  const o = ECONOMY.sponsorOffer;
  const avg = team.squad.length ? Math.round(team.squad.reduce((s, p) => s + p.rating, 0) / team.squad.length) : 55;
  const base = clamp(avg * o.baseRatingFactor, o.baseMin, o.baseMax);
  const names = shuffled(o.names, rng).slice(0, o.tiers.length);
  const amount = ([floor, range]: readonly [number, number]) =>
    floor === 0 && range === 0 ? 0 : Math.round((base * (floor + rng.next() * range)) / 10) * 10;
  return o.tiers.map((t, i) => ({ name: names[i], perMatch: amount(t.perMatch), bonus: amount(t.bonus) }));
}

/** Firma el sponsor: queda como vigente, cobra el bono y lo registra (HTML 553-561). */
export function signSponsor(team: Team, offer: SponsorOffer, season: number, matchday: number | null = null): void {
  team.finance.sponsor = { name: offer.name, perMatch: offer.perMatch, season };
  if (offer.bonus > 0) {
    team.budget += offer.bonus;
    recordMovement(team, { season, matchday }, 'bono', offer.bonus, `Bono por firmar con ${offer.name}`);
  }
}

/** La computadora elige sola: la oferta que más plata deja en la temporada (por fecha × fechas + bono). */
export function pickBestOffer(offers: SponsorOffer[], fechas: number): SponsorOffer {
  return offers.reduce((best, o) => (o.perMatch * fechas + o.bonus > best.perMatch * fechas + best.bonus ? o : best));
}

function findUser(state: GameState): Team | undefined {
  if (!state.userTeamId) return undefined;
  for (const d of ['A', 'B', 'C'] as const) {
    const t = state.divisions[d].teams.find((x) => x.id === state.userTeamId);
    if (t) return t;
  }
  return undefined;
}

/** Deja ofertas pendientes para el usuario si todavía no firmó sponsor en esta temporada (HTML 538-552). */
export function ensureSponsorOffers(state: GameState, rng?: Rng): void {
  const me = findUser(state);
  if (!me || me.finance.sponsor.season === state.season) {
    if (me) state.sponsorOffers = null;
    return;
  }
  if (state.sponsorOffers?.season === state.season) return;
  const r = rng ?? createRng(state.rngState);
  state.sponsorOffers = { season: state.season, offers: generateSponsorOffers(me, r) };
  if (!rng) state.rngState = r.state();
}

/** El usuario elige una de las ofertas pendientes. */
export function chooseSponsorOffer(state: GameState, index: number): ActionResult {
  const me = findUser(state);
  const pending = state.sponsorOffers;
  if (!me || !pending || pending.season !== state.season) return { ok: false, reason: 'No hay ofertas para elegir.' };
  const offer = pending.offers[index];
  if (!offer) return { ok: false, reason: 'Esa oferta no existe.' };
  const div = (['A', 'B', 'C'] as const).find((d) => state.divisions[d].teams.some((t) => t.id === me.id))!;
  signSponsor(me, offer, state.season, state.divisions[div].matchday);
  state.sponsorOffers = null;
  return { ok: true, cost: -offer.bonus };
}

// ---------------------------------------------------------------------------------------------
// Estadio (HTML 593-606)
// ---------------------------------------------------------------------------------------------

export function upgradeCost(capacity: number, key: StadiumUpgradeKey): number {
  const tier = STADIUM_UPGRADES.find((x) => x.key === key) ?? STADIUM_UPGRADES[1];
  return Math.round((capacity * tier.mult) / 10) * 10;
}

export function upgradeStadium(team: Team, key: StadiumUpgradeKey, ctx: FinanceCtx): ActionResult {
  if (!canSpend(team)) return { ok: false, reason: LOCKOUT_REASON };
  const tier = STADIUM_UPGRADES.find((x) => x.key === key);
  if (!tier) return { ok: false, reason: 'Esa ampliación no existe.' };
  const cost = upgradeCost(team.stadium.capacity, key);
  if (team.budget < cost) return { ok: false, reason: 'No alcanza el presupuesto.' };
  charge(team, ctx, 'estadio', cost, `${tier.label} del estadio (+${tier.add} lugares)`);
  team.stadium.capacity += tier.add;
  return { ok: true, cost };
}

/** Renombra el estadio (HTML 3957, 3961: máx 30, vacío = no cambia). */
export function renameStadium(team: Team, name: string): { ok: true } | { ok: false; reason: string } {
  const n = name.trim().slice(0, STADIUM_NAME_MAX);
  if (!n) return { ok: false, reason: 'El nombre no puede quedar vacío.' };
  team.stadium.name = n;
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Staff (HTML 3988-4018)
// ---------------------------------------------------------------------------------------------

export function staffDef(key: StaffKey) {
  return STAFF.defs.find((d) => d.key === key);
}

/** 5000 + 3500 por cada empleado de ese tipo que ya tenés (HTML 3998). */
export function hireCost(team: Team, key: StaffKey): number {
  return STAFF.hireBase + team.staff[key] * STAFF.hireStep;
}

export function hireStaff(team: Team, key: StaffKey, ctx: FinanceCtx): ActionResult {
  const def = staffDef(key);
  if (!def) return { ok: false, reason: 'Ese puesto no existe.' };
  if (!canSpend(team)) return { ok: false, reason: LOCKOUT_REASON };
  if (team.staff[key] >= def.max) return { ok: false, reason: `Ya tenés el máximo (${def.max}).` };
  const cost = hireCost(team, key);
  if (team.budget < cost) return { ok: false, reason: 'No alcanza el presupuesto.' };
  charge(team, ctx, 'empleados', cost, `Contratación: ${def.label}`);
  team.staff[key]++;
  return { ok: true, cost };
}

/** Despedir no cuesta ni devuelve plata; deja de cobrar sueldo. */
export function fireStaff(team: Team, key: StaffKey): ActionResult {
  const min = key === 'trainers' ? STAFF.minTrainers : 0;
  if (team.staff[key] <= min) return { ok: false, reason: min ? 'El club necesita al menos un preparador físico.' : 'No tenés a nadie en ese puesto.' };
  team.staff[key]--;
  return { ok: true, cost: 0 };
}

/** Nivel de médicos de cada lado, para `SimOptions.medicalLevel` (HTML 700). */
export function medicalLevels(home: Team, away: Team): { home: number; away: number } {
  return { home: home.staff.doctors, away: away.staff.doctors };
}

/** Multiplicador de la recuperación de cansancio en el banco (HTML 781). */
export function medicRecoveryMult(team: Team): number {
  return 1 + team.staff.medics * STAFF.medicRecovery;
}
