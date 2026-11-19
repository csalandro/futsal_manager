// Mercado de pases: ventanas, compra, ofertas y venta, cartera y mercado de la computadora.
// Port de HTML 805-846 (mercado de la IA), 4086-4426 (ventanas, compra, ofertas, cartera) y 2270-2294 (pretemporada).
// Las funciones que reciben GameState lo MUTAN (se llaman dentro de immer). Todo el azar sale del rng con semilla
// de `state.rngState`, que cada función persiste al terminar.
//
// Un "día" es una fecha de liga: día = matchday + 1 (HTML 4093). Las 3 divisiones avanzan juntas, así que se usa la A.
import type { GameState, Player, Position, Team, TransferOffer } from '../domain/types';
import { ECONOMY, MARKET, SQUAD } from './config';
import { canSpend, charge, LOCKOUT_REASON, recordMovement, type FinanceCtx } from './finance';
import { generatePlayer, playerValue, TIER_LEVEL } from './generate';
import { createRng, type Rng } from './rng';
import { assignFreeNumber, bestAvailableFive, canAddPlayer, removeFromTeam, sellBlocker } from './squad';
import { allTeams, findTeam, pushNews, teamDivision, userTeam } from './world';

const POSITIONS: Position[] = ['POR', 'CIE', 'ALA', 'PIV'];
const ctxOf = (state: GameState): FinanceCtx => ({ season: state.season, matchday: null });
const money = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;

function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------------------------
// Ventanas (HTML 4086-4105)
// ---------------------------------------------------------------------------------------------

export interface MarketWindow {
  open: boolean;
  /** Identificador de la ventana abierta (p. ej. 'early-2' o 'mid-2'); null si está cerrada. */
  id: string | null;
  /** Día de liga actual (matchday + 1). */
  day: number;
  preseason: boolean;
  /** Primer día de la próxima ventana de esta temporada; null = la próxima temporada. */
  nextOpenDay: number | null;
  /** Último día de la ventana abierta; null en pretemporada. */
  closesDay: number | null;
}

export function marketWindow(state: GameState): MarketWindow {
  const div = state.divisions.A;
  const day = div.matchday + 1;
  if (state.preseasonWeeksLeft > 0) {
    return { open: true, id: `early-${state.season}`, day, preseason: true, nextOpenDay: null, closesDay: null };
  }
  if (div.matchday >= div.schedule.length) return { open: false, id: null, day, preseason: false, nextOpenDay: null, closesDay: null };
  const cur = MARKET.windows.find((w) => day >= w.from && day <= w.to);
  if (cur) return { open: true, id: `${cur.id}-${state.season}`, day, preseason: false, nextOpenDay: null, closesDay: cur.to };
  const next = MARKET.windows.find((w) => w.from > day);
  return { open: false, id: null, day, preseason: false, nextOpenDay: next?.from ?? null, closesDay: null };
}

export function isTransferWindowOpen(state: GameState): boolean {
  return marketWindow(state).open;
}

/** Texto para la UI: estado de la ventana y cuándo abre/cierra. */
export function windowStatusText(w: MarketWindow): string {
  if (w.preseason) return 'Abierto: es la pretemporada.';
  if (w.open) return `Abierto hasta la fecha ${w.closesDay}.`;
  return w.nextOpenDay ? `Cerrado: abre en la fecha ${w.nextOpenDay}.` : 'Cerrado: vuelve a abrir en la próxima temporada.';
}

// ---------------------------------------------------------------------------------------------
// Pretemporada (HTML 2270-2273)
// ---------------------------------------------------------------------------------------------

export function isPreseason(state: GameState): boolean {
  return state.preseasonWeeksLeft > 0;
}

/** Avanza una semana de pretemporada (sin partidos). */
export function advancePreseason(state: GameState): void {
  if (state.preseasonWeeksLeft <= 0) return;
  state.preseasonWeeksLeft--;
  tickMarket(state);
}

// ---------------------------------------------------------------------------------------------
// Precios y aceptación (HTML 4189-4199, 4207)
// ---------------------------------------------------------------------------------------------

export const isFreeAgent = (state: GameState, playerId: string) => state.market.freeAgents.some((p) => p.id === playerId);

/** Precio de un agente libre: su valor (HTML 4343). */
export function freeAgentPrice(p: Player): number {
  return p.value;
}

/** Precio de un jugador de otro club: valor × 1,15 redondeado a 100 (HTML 4207). */
export function clubPrice(p: Player): number {
  return Math.round((playerValue(p.rating) * MARKET.clubPriceMult) / 100) * 100;
}

/** HTML 4189-4193. */
export function expectedDivisionRank(rating: number): number {
  return MARKET.expectedRank.find((r) => rating >= r.minRating)!.rank;
}

/** HTML 4194-4199. */
export function signingAcceptChance(fromRank: number, toRank: number): number {
  const gap = fromRank - toRank;
  const c = MARKET.acceptChance;
  return gap <= 0 ? c.same : gap === 1 ? c.oneLevel : c.moreLevels;
}

/** Posibilidad de que acepte venirse al usuario: depende de la división de origen (club) o del rating (agente libre). */
export function acceptChanceFor(state: GameState, playerId: string): number {
  const toRank = state.userDivision ? MARKET.divRank[state.userDivision] : 1;
  const found = findPlayer(state, playerId);
  if (!found) return 0;
  const fromRank = found.team ? MARKET.divRank[teamDivision(state, found.team.id) ?? 'C'] : expectedDivisionRank(found.player.rating);
  return signingAcceptChance(fromRank, toRank);
}

/** Busca un jugador en los agentes libres o en cualquier plantel. `team` es null para agentes libres. */
export function findPlayer(state: GameState, playerId: string): { player: Player; team: Team | null } | undefined {
  const free = state.market.freeAgents.find((p) => p.id === playerId);
  if (free) return { player: free, team: null };
  for (const t of allTeams(state)) {
    const p = t.squad.find((x) => x.id === playerId);
    if (p) return { player: p, team: t };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Ojeadores: potencial visible
// ---------------------------------------------------------------------------------------------

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Potencial que ve el usuario de un jugador ajeno. Con ojeadores (staff.scouts >= MARKET.scoutsToReveal) es el real;
 * sin ellos, un rango estimado que contiene al real, determinista por jugador (no cambia entre recargas).
 * No hay regla clara de ojeadores para el mercado en el original, que muestra siempre el real (HTML 4326).
 */
export function scoutedPotential(p: Player, scouts: number): { exact: boolean; min: number; max: number } {
  if (scouts >= MARKET.scoutsToReveal) return { exact: true, min: p.potential, max: p.potential };
  const h = hashId(p.id);
  const [bLo, bHi] = MARKET.potentialSpread.below;
  const [aLo, aHi] = MARKET.potentialSpread.above;
  const below = bLo + (h % (bHi - bLo + 1));
  const above = aLo + ((h >>> 8) % (aHi - aLo + 1));
  return { exact: false, min: Math.max(p.rating, p.potential - below), max: Math.min(99, p.potential + above) };
}

// ---------------------------------------------------------------------------------------------
// Compra (HTML 4200-4230, 4343-4352)
// ---------------------------------------------------------------------------------------------

export type MarketResult =
  | { ok: true; price: number; player: Player; from: string }
  | { ok: false; reason: string; rejected?: boolean };

/** Motivo por el que el usuario no puede ofertar por este jugador ahora, o null. */
export function buyBlocker(state: GameState, playerId: string): string | null {
  const me = userTeam(state);
  if (!me) return 'No hay equipo.';
  const found = findPlayer(state, playerId);
  if (!found) return 'El jugador ya no está disponible.';
  const { player, team } = found;
  if (team?.id === me.id) return 'Ya es tuyo.';
  if (!isTransferWindowOpen(state)) return 'El mercado está cerrado.'; // HTML 4097-4105
  if (!canSpend(me)) return LOCKOUT_REASON; // HTML 4202
  if (!canAddPlayer(me)) return 'Plantel lleno.';
  if (state.market.refused.includes(playerId)) return 'Ya te rechazó en esta ventana.';
  if (team) {
    if (player.pos === 'POR' && team.squad.filter((x) => x.pos === 'POR').length <= 1) return 'Es el único arquero de su club.';
    if (team.squad.length <= SQUAD.minAfterFire) return 'Su club no puede quedarse con tan pocos jugadores.';
  }
  const price = team ? clubPrice(player) : freeAgentPrice(player);
  if (me.budget < price) return 'No alcanza el presupuesto.';
  return null;
}

/** Ofertar por un agente libre o por un jugador de otro club. Puede ser rechazado (azar según la categoría). */
export function buyPlayer(state: GameState, playerId: string): MarketResult {
  const blocker = buyBlocker(state, playerId);
  if (blocker) return { ok: false, reason: blocker };
  const me = userTeam(state)!;
  const { player, team: seller } = findPlayer(state, playerId)!;
  const price = seller ? clubPrice(player) : freeAgentPrice(player);

  const rng = createRng(state.rngState);
  const accepted = rng.chance(acceptChanceFor(state, playerId));
  if (!accepted) {
    state.market.refused.push(playerId);
    state.rngState = rng.state();
    const why = seller ? 'juega en un nivel más alto y no quiere bajar de categoría' : 'busca un club de una categoría más alta';
    pushNews(state, `❌ ${player.name} rechazó la oferta: ${why}.`);
    return { ok: false, reason: `${player.name} rechazó la oferta: ${why}.`, rejected: true };
  }

  const ctx = ctxOf(state);
  charge(me, ctx, 'fichajes', price, `Fichaje de ${player.name}${seller ? ` (${seller.name})` : ''}`);
  let from = 'agente libre';
  // Se mueve el mismo objeto (no una copia): así conserva stats, lesiones y demás sin duplicar proxies de immer.
  const moved = player;
  moved.transferListed = false;
  if (seller) {
    from = seller.name;
    seller.budget += price;
    recordMovement(seller, ctx, 'ventas', price, `Venta de ${player.name} a ${me.name}`, ECONOMY.logSizeCpu);
    removeFromTeam(seller, playerId);
    if (seller.lineup.some((id) => !id)) seller.lineup = bestAvailableFive(seller);
    state.market.clubListings = state.market.clubListings.filter((e) => e.playerId !== playerId);
  } else {
    state.market.freeAgents = state.market.freeAgents.filter((p) => p.id !== playerId);
  }
  moved.contractYears = rng.int(MARKET.contractYears[0], MARKET.contractYears[1]);
  assignFreeNumber(me, moved, rng);
  me.squad.push(moved);
  state.watchlist = state.watchlist.filter((e) => e.playerId !== playerId);
  state.rngState = rng.state();
  pushNews(state, seller ? `✍️ Fichaste a ${player.name}, que venía de ${seller.name}.` : `✍️ Fichaste a ${player.name} como agente libre.`);
  return { ok: true, price, player: moved, from };
}

// ---------------------------------------------------------------------------------------------
// Venta y ofertas (HTML 4116-4158, 3018-3023)
// ---------------------------------------------------------------------------------------------

/** Marca o desmarca a un jugador como transferible (los que no lo están no reciben ofertas). */
export function toggleTransferListed(state: GameState, playerId: string): { ok: true; listed: boolean } | { ok: false; reason: string } {
  const me = userTeam(state);
  const p = me?.squad.find((x) => x.id === playerId);
  if (!me || !p) return { ok: false, reason: 'El jugador no está en el plantel.' };
  p.transferListed = !p.transferListed;
  if (!p.transferListed) state.market.offers = state.market.offers.filter((o) => o.playerId !== playerId);
  return { ok: true, listed: p.transferListed };
}

/** Motivo por el que no se puede aceptar una oferta ahora, o null. */
export function offerBlocker(state: GameState, offer: TransferOffer): string | null {
  const me = userTeam(state);
  const p = me?.squad.find((x) => x.id === offer.playerId);
  const club = findTeam(state, offer.teamId);
  if (!me || !p || !club) return 'La oferta ya no está vigente.';
  if (!isTransferWindowOpen(state)) return 'El mercado está cerrado.';
  const why = sellBlocker(me, p);
  if (why) return why;
  if (club.squad.length >= SQUAD.max) return `${club.name} ya no tiene lugar en el plantel.`;
  // El club pudo gastar entre que ofertó y la aceptación (mercado de la IA): se revalida.
  if (club.budget < offer.price) return `${club.name} ya no tiene presupuesto para pagar.`;
  return null;
}

/** Acepta una oferta: sale del plantel (y de la alineación y los pateadores), cobra el usuario y paga el club. */
export function acceptOffer(state: GameState, playerId: string, teamId: string): MarketResult {
  const offer = state.market.offers.find((o) => o.playerId === playerId && o.teamId === teamId);
  if (!offer) return { ok: false, reason: 'La oferta ya no está vigente.' };
  const why = offerBlocker(state, offer);
  if (why) return { ok: false, reason: why };
  const me = userTeam(state)!;
  const club = findTeam(state, teamId)!;
  const p = me.squad.find((x) => x.id === playerId)!;
  const rng = createRng(state.rngState);
  const ctx = ctxOf(state);

  me.budget += offer.price;
  recordMovement(me, ctx, 'ventas', offer.price, `Venta de ${p.name} a ${club.name}`);
  // HTML 4145: el club paga aunque se endeude un poco; acá las ofertas solo las hacen clubes que pueden pagar.
  charge(club, ctx, 'fichajes', offer.price, `Fichaje de ${p.name} (${me.name})`);
  removeFromTeam(me, playerId);
  const moved = p;
  moved.transferListed = false;
  moved.contractYears = rng.int(MARKET.contractYears[0], MARKET.contractYears[1]);
  assignFreeNumber(club, moved, rng);
  club.squad.push(moved);
  state.market.offers = state.market.offers.filter((o) => o.playerId !== playerId);
  state.rngState = rng.state();
  pushNews(state, `🤝 Vendiste a ${p.name} a ${club.name} por ${money(offer.price)}.`);
  return { ok: true, price: offer.price, player: moved, from: club.name };
}

export function rejectOffer(state: GameState, playerId: string, teamId: string): void {
  state.market.offers = state.market.offers.filter((o) => !(o.playerId === playerId && o.teamId === teamId));
}

// ---------------------------------------------------------------------------------------------
// Cartera (HTML 4177-4188, 4231-4273)
// ---------------------------------------------------------------------------------------------

export const isWatched = (state: GameState, playerId: string) => state.watchlist.some((e) => e.playerId === playerId);

/** Agrega o quita a un jugador de otro club de la cartera. */
export function toggleWatch(state: GameState, playerId: string): { ok: true; watching: boolean } | { ok: false; reason: string } {
  if (isWatched(state, playerId)) {
    state.watchlist = state.watchlist.filter((e) => e.playerId !== playerId);
    return { ok: true, watching: false };
  }
  const found = findPlayer(state, playerId);
  if (!found?.team) return { ok: false, reason: 'Solo se pueden seguir jugadores de otros clubes.' };
  if (found.team.id === state.userTeamId) return { ok: false, reason: 'Ya es tuyo.' };
  if (state.watchlist.length >= MARKET.watchlistMax) return { ok: false, reason: `La cartera admite hasta ${MARKET.watchlistMax} jugadores.` };
  const { player, team } = found;
  state.watchlist.push({
    playerId,
    teamId: team.id,
    since: { season: state.season, rating: player.rating, potential: player.potential },
    history: [{ season: state.season, rating: player.rating }],
  });
  return { ok: true, watching: true };
}

/**
 * Pone al día la cartera: saca a los que se retiraron o ya son del usuario (HTML 4235-4239), actualiza el club
 * y, al cambiar de temporada, suma el rating al historial de evolución.
 */
export function refreshWatchlist(state: GameState): void {
  const next = [];
  for (const e of state.watchlist) {
    const found = findPlayer(state, e.playerId);
    if (!found?.team || found.team.id === state.userTeamId) continue;
    e.teamId = found.team.id;
    const last = e.history[e.history.length - 1];
    if (!last || last.season !== state.season) {
      e.history.push({ season: state.season, rating: found.player.rating });
      if (e.history.length > 12) e.history.shift();
    }
    next.push(e);
  }
  state.watchlist = next;
}

// ---------------------------------------------------------------------------------------------
// Mercado de la computadora (HTML 805-846) + freno a los presupuestos
// ---------------------------------------------------------------------------------------------

function pickPosition(rng: Rng): Position {
  return rng.pick(POSITIONS);
}

function range(rng: Rng, r: readonly [number, number] | readonly number[]): number {
  return rng.int(r[0], r[1]);
}

function newsAboutSigning(state: GameState, team: Team, p: Player, price: number): void {
  if (!state.userDivision || p.rating < MARKET.newsMinRating) return;
  if (teamDivision(state, team.id) !== state.userDivision || team.id === state.userTeamId) return;
  pushNews(state, `💼 ${team.name} fichó a ${p.name} (${p.pos}, ${p.rating}) por ${money(price)}.`);
}

function signForAi(state: GameState, team: Team, p: Player, price: number, rng: Rng): void {
  team.budget -= price;
  recordMovement(team, ctxOf(state), 'fichajes', -price, `Fichaje de ${p.name}`, ECONOMY.logSizeCpu);
  assignFreeNumber(team, p, rng);
  team.squad.push(p);
  newsAboutSigning(state, team, p, price);
}

function sellWeakest(state: GameState, team: Team): void {
  const porCount = team.squad.filter((x) => x.pos === 'POR').length;
  const pool = porCount <= 1 ? team.squad.filter((x) => x.pos !== 'POR') : team.squad;
  const weakest = [...pool].sort((a, b) => a.rating - b.rating)[0];
  if (!weakest) return;
  const cash = Math.round(weakest.value * MARKET.ai.sellShare);
  removeFromTeam(team, weakest.id);
  team.budget += cash;
  recordMovement(team, ctxOf(state), 'ventas', cash, `Venta de ${weakest.name}`, ECONOMY.logSizeCpu);
}

/** HTML 805-832: compra con 35% (50% de un agente libre, si no uno generado) y vende al más flojo con 25%. */
function aiMarketMove(state: GameState, team: Team, rng: Rng, poolPicks: { left: number }): void {
  const ai = MARKET.ai;
  if (rng.chance(ai.buyChance) && team.squad.length < SQUAD.max) {
    const pool = state.market.freeAgents;
    let p: Player;
    if (pool.length > 0 && poolPicks.left > 0 && rng.chance(ai.fromPoolChance)) {
      p = rng.pick(pool);
      poolPicks.left--;
    } else {
      const base = rng.chance(ai.starChance) ? range(rng, ai.star) : range(rng, ai.regular);
      p = generatePlayer(rng, pickPosition(rng), base);
    }
    if (team.budget >= p.value) {
      state.market.freeAgents = state.market.freeAgents.filter((x) => x.id !== p.id);
      signForAi(state, team, p, p.value, rng);
    }
  }
  if (rng.chance(ai.sellChance) && team.squad.length > ai.sellMinSquad) sellWeakest(state, team);
}

/**
 * NO está en el original: un equipo con más plata que `reserve` invierte `surplusShare` del excedente en fichajes
 * de buen nivel (hasta `maxSurplusBuys`), así el presupuesto de la computadora no se multiplica temporada a temporada.
 * Con el plantel lleno, el fichaje reemplaza al más flojo solo si lo mejora en `swapMinGain` puntos.
 */
function aiInvestSurplus(state: GameState, team: Team, rng: Rng): void {
  const ai = MARKET.ai;
  const [lo, hi] = TIER_LEVEL[teamDivision(state, team.id) ?? 'C'];
  const target = (): [number, number] => [lo + ai.surplusTierBonus, hi + ai.surplusTierBonus];
  const priceOf = (p: Player) => Math.round((p.value * ai.surplusPriceMult) / 100) * 100;
  let spendable = Math.floor((team.budget - ai.reserve) * ai.surplusShare);
  for (let i = 0; i < ai.maxSurplusBuys && spendable > 0; i++) {
    const needGk = team.squad.filter((x) => x.pos === 'POR').length < 2;
    const pos: Position = needGk ? 'POR' : rng.pick(['CIE', 'ALA', 'PIV'] as const);
    let p = generatePlayer(rng, pos, range(rng, target()));
    // Si no le alcanza, apunta más bajo (dos intentos más).
    for (let k = 0; k < 2 && priceOf(p) > spendable; k++) p = generatePlayer(rng, pos, range(rng, [lo - 8, lo]));
    if (priceOf(p) > spendable) break;
    if (team.squad.length >= SQUAD.max) {
      const weakest = [...team.squad].sort((a, b) => a.rating - b.rating).find((x) => x.pos !== 'POR' || pos === 'POR');
      if (!weakest || p.rating < weakest.rating + ai.swapMinGain) break;
      removeFromTeam(team, weakest.id); // se lo libera sin cobrar: la plata de la inversión no vuelve
    }
    const price = priceOf(p);
    signForAi(state, team, p, price, rng);
    spendable -= price;
  }
}

function runAiWindow(state: GameState, rng: Rng, withMoves: boolean): void {
  const poolPicks = { left: MARKET.ai.poolPicksPerEvent };
  for (const t of allTeams(state)) {
    if (t.id === state.userTeamId) continue;
    if (withMoves) aiMarketMove(state, t, rng, poolPicks);
    aiInvestSurplus(state, t, rng);
    t.lineup = bestAvailableFive(t);
  }
}

// ---------------------------------------------------------------------------------------------
// Reloj del mercado
// ---------------------------------------------------------------------------------------------

function generateFreeAgents(rng: Rng): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < MARKET.freeAgentCount; i++) {
    const base = rng.chance(MARKET.freeAgentStarChance) ? range(rng, MARKET.freeAgentStar) : range(rng, MARKET.freeAgentRegular);
    out.push(generatePlayer(rng, pickPosition(rng), base));
  }
  return out;
}

function refreshClubListings(state: GameState, rng: Rng): void {
  const candidates: { playerId: string; teamId: string }[] = [];
  for (const club of allTeams(state)) {
    if (club.id === state.userTeamId || club.squad.length <= SQUAD.minAfterFire) continue;
    const gks = club.squad.filter((x) => x.pos === 'POR').length;
    for (const p of club.squad) if (!(p.pos === 'POR' && gks <= 1)) candidates.push({ playerId: p.id, teamId: club.id });
  }
  state.market.clubListings = shuffled(candidates, rng).slice(0, MARKET.clubListingCount);
}

function rollOffers(state: GameState, me: Team, rng: Rng): void {
  const m = state.market;
  m.offers = m.offers.filter((o) => me.squad.some((p) => p.id === o.playerId && p.transferListed));
  if (m.offers.length >= MARKET.offers.max || !rng.chance(MARKET.offers.chancePerDay)) return;
  const eligible = me.squad.filter((p) => p.transferListed && !m.offers.some((o) => o.playerId === p.id) && sellBlocker(me, p) === null);
  if (eligible.length === 0) return;
  const p = rng.pick(eligible);
  const [lo, hi] = p.contractYears <= 1 ? MARKET.offers.shortContract : MARKET.offers.longContract;
  const price = Math.round((playerValue(p.rating) * rng.int(lo, hi)) / 100 / 100) * 100;
  const clubs = allTeams(state).filter((c) => c.id !== me.id && c.squad.length < SQUAD.max && c.budget >= price);
  if (clubs.length === 0) return;
  const club = rng.pick(clubs);
  m.offers.push({ playerId: p.id, teamId: club.id, price });
  pushNews(state, `💰 ${club.name} ofreció ${money(price)} por ${p.name}.`);
}

/**
 * Avanza el reloj del mercado; se llama al empezar la temporada, tras cada fecha, en cada semana de pretemporada y
 * al cargar/elegir equipo. Es idempotente para el mismo día. Con la ventana cerrada, las ofertas y listas vencen.
 *
 * Eventos de la computadora (una vez por ventana, nunca en pretemporada): `open` (día 1 o 16: fichajes y ventas del original
 * + inversión del excedente) y `close` (último día de la ventana: solo inversión del excedente).
 */
export function tickMarket(state: GameState): void {
  const m = state.market;
  const w = marketWindow(state);
  m.aiDone = m.aiDone.filter((e) => e.includes(`-${state.season}:`));
  const key = `${state.season}:${state.divisions.A.matchday}:${state.preseasonWeeksLeft}`;
  if (!w.open) {
    m.offers = [];
    m.clubListings = [];
    m.dayKey = key;
    refreshWatchlist(state);
    return;
  }
  const rng = createRng(state.rngState);
  if (m.freeAgentsWindow !== w.id) {
    m.freeAgents = generateFreeAgents(rng);
    m.freeAgentsWindow = w.id;
    m.refused = [];
  }
  // La computadora mueve recién cuando arranca la liga (HTML 839-846: días 1 y 16): en la pretemporada el usuario tiene la primera opción.
  const open = `${w.id}:open`;
  if (!w.preseason && !m.aiDone.includes(open)) {
    m.aiDone.push(open);
    runAiWindow(state, rng, true);
  }
  const close = `${w.id}:close`;
  if (w.closesDay !== null && w.day >= w.closesDay && !m.aiDone.includes(close)) {
    m.aiDone.push(close);
    runAiWindow(state, rng, false);
  }
  if (m.dayKey !== key) {
    m.dayKey = key;
    refreshClubListings(state, rng);
    const me = userTeam(state);
    if (me) rollOffers(state, me, rng);
  }
  state.rngState = rng.state();
  refreshWatchlist(state);
}
