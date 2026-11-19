import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GameState, StaffKey, Tactic, Team, TrainingIntensity } from '../domain/types';
import type { StadiumUpgradeKey } from '../engine/config';
import {
  chooseSponsorOffer, ensureSponsorOffers, fireStaff, hireStaff, medicalLevels, recordMovement, renameStadium,
  setTicketPrice, upgradeStadium, type FinanceCtx,
} from '../engine/finance';
import { ensureCompetitions } from '../engine/competitions';
import { acceptJobOffer, openTenure, rejectJobOffer, renameDt, setDtAge } from '../engine/dt';
import { createNewGame } from '../engine/generate';
import { composeMatch, simulateHalf, type HalfResult, type SimulatedMatch } from '../engine/match';
import { acceptOffer, advancePreseason, buyPlayer, isPreseason, rejectOffer, tickMarket, toggleTransferListed, toggleWatch } from '../engine/market';
import { createRng, randomSeed } from '../engine/rng';
import { isSeasonOver, playNextStep, pushNews, startNewSeason, userNextFixture, userTeam, waitForOffers } from '../engine/season';
import type { ActionResult } from '../engine/squad';
import {
  bestAvailableFive, firePlayer, lineupIssues, movePenaltyTaker, renewContract, setPlayerNumber, togglePenaltyTaker,
} from '../engine/squad';
import { setTrainingIntensity, toggleTraining, upgradeTrainingFacility } from '../engine/training';
import { demoteToAcademy, promoteYouth, sellYouth, upgradeAcademy } from '../engine/youth';
import { repository, type SaveSummary } from '../repo';
import { onLogout } from './authStore';

export type Screen = 'menu' | 'pickTeam' | 'game' | 'admin';
export type ClubView = 'finanzas' | 'estadio' | 'empleados' | 'sponsor' | 'dt';
export type Tab = 'home' | 'squad' | 'tactics' | 'table' | 'fixture' | 'market' | 'club';

/** Resultado de una acción de mercado: `ok` y el texto para mostrarle al usuario. */
export interface MarketNotice {
  ok: boolean;
  message: string;
}

/** Movimientos del usuario fuera de fecha: se anotan en la temporada en curso, sin número de fecha. */
const offMatchday = (g: GameState): FinanceCtx => ({ season: g.season, matchday: null });

export interface LiveMatch {
  /** Primer tiempo ya simulado. */
  half1: HalfResult;
  /** Partido completo; null hasta que se juega el segundo tiempo (después del entretiempo). */
  sim: SimulatedMatch | null;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  userIsHome: boolean;
  /** Eliminatoria: si termina empatado hay tanda de penales. */
  knockout: boolean;
  /** "Fecha 7", "Copa · Octavos de final", ... */
  label: string;
}

interface Store {
  screen: Screen;
  tab: Tab;
  game: GameState | null;
  slot: number;
  saves: SaveSummary[];
  busy: boolean;
  error: string | null;
  live: LiveMatch | null;
  /** Subvista abierta en Club (para poder entrar directo a DT desde Inicio). */
  clubView: ClubView;

  refreshSaves(): Promise<void>;
  newGame(dtName: string, slot: number): void;
  pickTeam(teamId: string): Promise<void>;
  loadGame(slot: number): Promise<void>;
  deleteSave(slot: number): Promise<void>;
  persist(): Promise<void>;
  setTab(tab: Tab): void;
  setClubView(view: ClubView): void;
  /** Abre Club en una subvista. */
  openClub(view: ClubView): void;
  backToMenu(): void;
  openAdmin(): void;
  /** Vuelve al estado inicial (al cerrar sesión). */
  reset(): void;

  /** Simula el 1er tiempo del partido del usuario y abre el relato en vivo. */
  startUserMatch(): void;
  /** Simula el 2º tiempo con las tácticas actuales del usuario y arma el partido completo. */
  resumeSecondHalf(): void;
  /** Cierra el relato y juega el resto de la fecha. */
  finishUserMatch(): Promise<void>;
  /** Juega el paso actual del calendario (fecha, ronda de copa, playoff...) sin ver el partido. */
  quickPlayStep(): Promise<void>;
  nextSeason(): Promise<void>;
  /** Avanza una semana de pretemporada (sin partidos). */
  advancePreseason(): Promise<void>;

  setLineupSlot(index: number, playerId: string | null): void;
  setTactic(patch: Partial<Tactic>): void;
  /** Pone en la alineación a los mejores disponibles. */
  autoLineup(): void;
  /** Las acciones de plantel devuelven un mensaje de error (o null si salió bien). */
  renewContract(playerId: string): string | null;
  firePlayer(playerId: string): string | null;
  setPlayerNumber(playerId: string, n: number): string | null;
  togglePenaltyTaker(playerId: string): void;
  movePenaltyTaker(playerId: string, dir: -1 | 1): void;

  /** Acciones del club: devuelven un mensaje de error (o null si salió bien). */
  setTicketPrice(price: number): string | null;
  upgradeStadium(key: StadiumUpgradeKey): string | null;
  renameStadium(name: string): string | null;
  hireStaff(key: StaffKey): string | null;
  fireStaff(key: StaffKey): string | null;
  chooseSponsor(index: number): string | null;

  /** Mercado de pases. */
  buyPlayer(playerId: string): MarketNotice;
  toggleTransferListed(playerId: string): MarketNotice;
  acceptOffer(playerId: string, teamId: string): MarketNotice;
  rejectOffer(playerId: string, teamId: string): void;
  toggleWatch(playerId: string): MarketNotice;

  /** Entrenamiento y cantera: devuelven un mensaje de error (o null si salió bien). */
  toggleTraining(playerId: string): string | null;
  setTrainingIntensity(playerId: string, intensity: TrainingIntensity): string | null;
  upgradeTrainingFacility(): string | null;
  upgradeAcademy(): string | null;
  promoteYouth(playerId: string): string | null;
  demoteToAcademy(playerId: string): string | null;
  sellYouth(playerId: string): string | null;

  /** DT: perfil y ofertas de trabajo. */
  setDtName(name: string): void;
  setDtAge(age: number): void;
  acceptJobOffer(teamId: string): string | null;
  rejectJobOffer(teamId: string): void;
  /** Sin club: deja pasar el tiempo hasta que llegue alguna oferta. */
  waitForOffers(): Promise<void>;
}

let saving: Promise<void> | null = null;
let saveQueued = false;

export const useGame = create<Store>()(
  immer((set, get) => ({
    screen: 'menu',
    tab: 'home',
    game: null,
    slot: 1,
    saves: [],
    busy: false,
    error: null,
    live: null,
    clubView: 'finanzas',

    async refreshSaves() {
      try {
        const saves = await repository.listSaves();
        set({ saves });
      } catch (e) {
        set({ error: String(e) });
      }
    },

    newGame(dtName, slot) {
      const game = createNewGame(randomSeed(), dtName.trim().slice(0, 24) || 'DT');
      set({ game, slot, screen: 'pickTeam', tab: 'home', live: null, error: null });
    },

    async pickTeam(teamId) {
      set((s) => {
        if (!s.game) return;
        const div = (['A', 'B', 'C'] as const).find((d) => s.game!.divisions[d].teams.some((t) => t.id === teamId));
        s.game.userTeamId = teamId;
        s.game.userDivision = div ?? null;
        openTenure(s.game);
        ensureSponsorOffers(s.game);
        ensureCompetitions(s.game); // sortea la copa y fija el objetivo del usuario
        tickMarket(s.game); // arma el mercado ya sabiendo cuál es el equipo del usuario
        s.screen = 'game';
      });
      await get().persist();
    },

    async loadGame(slot) {
      set({ busy: true, error: null });
      try {
        const game = await repository.load(slot);
        if (!game) throw new Error('No se pudo cargar la partida (vacía o de una versión incompatible)');
        ensureSponsorOffers(game); // partidas migradas o con la temporada recién empezada
        ensureCompetitions(game); // partidas migradas de v4: sortea la copa, arma los playoffs y fija el objetivo
        tickMarket(game); // partidas migradas de v3: arma el mercado de la ventana en curso
        set({ game, slot, screen: game.userTeamId || game.dt.unemployed ? 'game' : 'pickTeam', tab: 'home', live: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ busy: false });
      }
    },

    async deleteSave(slot) {
      await repository.remove(slot);
      await get().refreshSaves();
    },

    async persist() {
      // Un solo guardado en vuelo: si llegan pedidos mientras tanto, al terminar se guarda
      // una vez más con el estado más reciente. Así un PUT viejo nunca pisa a uno nuevo.
      if (!get().game) return;
      // Durante un partido en vivo no se guarda: el rngState ya avanzó con el 1er tiempo y, si se
      // persistiera, recargar la página permitiría repetir el partido hasta sacar otro resultado.
      // finishUserMatch limpia `live` y guarda todo junto.
      if (get().live) return;
      saveQueued = true;
      if (saving) return saving;
      set({ busy: true });
      saving = (async () => {
        while (saveQueued) {
          saveQueued = false;
          const { game, slot } = get();
          if (!game) break;
          try {
            await repository.save(slot, game);
            set({ error: null });
          } catch (e) {
            set({ error: `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
      })().finally(() => {
        saving = null;
        set({ busy: false });
      });
      return saving;
    },

    setTab(tab) {
      set({ tab });
    },

    setClubView(view) {
      set({ clubView: view });
    },

    openClub(view) {
      set({ tab: 'club', clubView: view });
    },

    backToMenu() {
      set({ screen: 'menu', live: null, error: null });
      void get().refreshSaves();
    },

    openAdmin() {
      set({ screen: 'admin', live: null, error: null });
    },

    reset() {
      set({ screen: 'menu', tab: 'home', game: null, slot: 1, saves: [], busy: false, error: null, live: null });
    },

    startUserMatch() {
      set((s) => {
        if (!s.game || s.live || isPreseason(s.game)) return;
        const fx = userNextFixture(s.game);
        if (!fx) return;
        const me = userTeam(s.game);
        if (!me || lineupIssues(me).length > 0) return;
        const userIsHome = fx.home.id === s.game.userTeamId;
        // El rival (computadora) arma su alineación con los disponibles.
        const rival = userIsHome ? fx.away : fx.home;
        rival.lineup = bestAvailableFive(rival);
        const rng = createRng(s.game.rngState);
        const half1 = simulateHalf(fx.home, fx.away, rng, 1, { medicalLevel: medicalLevels(fx.home, fx.away) });
        s.game.rngState = rng.state();
        s.live = {
          half1, sim: null, homeId: fx.home.id, awayId: fx.away.id,
          homeName: fx.home.name, awayName: fx.away.name, userIsHome, knockout: fx.knockout, label: fx.label,
        };
      });
    },

    resumeSecondHalf() {
      set((s) => {
        if (!s.game || !s.live || s.live.sim) return;
        const fx = userNextFixture(s.game);
        if (!fx || fx.home.id !== s.live.homeId || fx.away.id !== s.live.awayId) return;
        const rng = createRng(s.game.rngState);
        const second = simulateHalf(fx.home, fx.away, rng, 2, {
          prior: s.live.half1.events,
          medicalLevel: medicalLevels(fx.home, fx.away),
        });
        s.live.sim = composeMatch(fx.home, fx.away, s.live.half1, second, rng, { knockout: s.live.knockout });
        s.game.rngState = rng.state();
      });
      void get().persist();
    },

    async finishUserMatch() {
      set((s) => {
        if (!s.game || !s.live?.sim) return;
        playNextStep(s.game, s.live.sim);
        s.live = null;
      });
      await get().persist();
    },

    async quickPlayStep() {
      set((s) => {
        const me = s.game && userTeam(s.game);
        if (!s.game || !me || s.live || isPreseason(s.game) || isSeasonOver(s.game)) return;
        // Con partido propio en este paso hace falta una alineación válida; sin partido propio se simula directo.
        if (userNextFixture(s.game) && lineupIssues(me).length > 0) return;
        playNextStep(s.game);
      });
      await get().persist();
    },

    async nextSeason() {
      set((s) => {
        if (s.game && isSeasonOver(s.game)) startNewSeason(s.game);
      });
      await get().persist();
    },

    async advancePreseason() {
      set((s) => {
        if (s.game && !s.live) advancePreseason(s.game);
      });
      await get().persist();
    },

    setLineupSlot(index, playerId) {
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!team) return;
        // Si el jugador ya estaba en otro puesto, se intercambian.
        const prev = team.lineup.indexOf(playerId);
        if (playerId && prev >= 0) team.lineup[prev] = team.lineup[index];
        team.lineup[index] = playerId;
      });
      void get().persist();
    },

    setTactic(patch) {
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (team) Object.assign(team.tactic, patch);
      });
      void get().persist();
    },
    autoLineup() {
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (team) team.lineup = bestAvailableFive(team);
      });
      void get().persist();
    },

    renewContract(playerId) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!s.game || !team) return;
        const rng = createRng(s.game.rngState);
        const res = renewContract(team, playerId, rng);
        s.game.rngState = rng.state();
        if (!res.ok) error = res.reason;
        else {
          const name = team.squad.find((p) => p.id === playerId)?.name ?? 'El jugador';
          pushNews(s.game, `✍️ Renovaste a ${name} por ${res.added} temporada${res.added === 1 ? '' : 's'} más.`);
          recordMovement(team, offMatchday(s.game), 'contratos', -res.cost, `Renovación de ${name}`);
        }
      });
      if (!error) void get().persist();
      return error;
    },

    firePlayer(playerId) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!s.game || !team) return;
        const name = team.squad.find((p) => p.id === playerId)?.name ?? 'el jugador';
        const res = firePlayer(team, playerId);
        if (!res.ok) error = res.reason;
        else {
          pushNews(s.game, `📄 Despediste a ${name}: indemnización de ${res.cost.toLocaleString('es-AR')}.`);
          recordMovement(team, offMatchday(s.game), 'contratos', -res.cost, `Indemnización a ${name}`);
        }
      });
      if (!error) void get().persist();
      return error;
    },

    setPlayerNumber(playerId, n) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!team) return;
        const res = setPlayerNumber(team, playerId, n);
        if (!res.ok) error = res.reason;
      });
      if (!error) void get().persist();
      return error;
    },

    togglePenaltyTaker(playerId) {
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (team) togglePenaltyTaker(team, playerId);
      });
      void get().persist();
    },

    movePenaltyTaker(playerId, dir) {
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (team) movePenaltyTaker(team, playerId, dir);
      });
      void get().persist();
    },

    setTicketPrice(price) {
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (team) setTicketPrice(team, price);
      });
      void get().persist();
      return null;
    },

    upgradeStadium(key) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!s.game || !team) return;
        const res = upgradeStadium(team, key, offMatchday(s.game));
        if (!res.ok) error = res.reason;
        else pushNews(s.game, `🏟️ Ampliaste el estadio: ahora entran ${team.stadium.capacity.toLocaleString('es-AR')} personas.`);
      });
      if (!error) void get().persist();
      return error;
    },

    renameStadium(name) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!team) return;
        const res = renameStadium(team, name);
        if (!res.ok) error = res.reason;
      });
      if (!error) void get().persist();
      return error;
    },

    hireStaff(key) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!s.game || !team) return;
        const res = hireStaff(team, key, offMatchday(s.game));
        if (!res.ok) error = res.reason;
      });
      if (!error) void get().persist();
      return error;
    },

    fireStaff(key) {
      let error: string | null = null;
      set((s) => {
        const team = s.game && userTeam(s.game);
        if (!team) return;
        const res = fireStaff(team, key);
        if (!res.ok) error = res.reason;
      });
      if (!error) void get().persist();
      return error;
    },

    chooseSponsor(index) {
      let error: string | null = null;
      set((s) => {
        if (!s.game) return;
        const res = chooseSponsorOffer(s.game, index);
        if (!res.ok) error = res.reason;
        else {
          const me = userTeam(s.game)!;
          pushNews(s.game, `🤝 Nuevo auspiciante: ${me.finance.sponsor.name}, $ ${me.finance.sponsor.perMatch.toLocaleString('es-AR')} por fecha.`);
        }
      });
      if (!error) void get().persist();
      return error;
    },

    buyPlayer(playerId) {
      let notice: MarketNotice = { ok: false, message: 'No hay partida.' };
      set((s) => {
        if (!s.game || s.live) return;
        const res = buyPlayer(s.game, playerId);
        notice = res.ok
          ? { ok: true, message: `Fichaste a ${res.player.name} (${res.from}) por $ ${res.price.toLocaleString('es-AR')}.` }
          : { ok: false, message: res.reason };
      });
      void get().persist(); // un rechazo también consume azar: se guarda para que recargar no permita repetirlo
      return notice;
    },

    toggleTransferListed(playerId) {
      let notice: MarketNotice = { ok: false, message: 'No hay partida.' };
      set((s) => {
        if (!s.game || s.live) return;
        const res = toggleTransferListed(s.game, playerId);
        notice = res.ok
          ? { ok: true, message: res.listed ? 'Quedó en la lista de transferibles: puede recibir ofertas.' : 'Salió de la lista de transferibles.' }
          : { ok: false, message: res.reason };
      });
      void get().persist();
      return notice;
    },

    acceptOffer(playerId, teamId) {
      let notice: MarketNotice = { ok: false, message: 'No hay partida.' };
      set((s) => {
        if (!s.game || s.live) return;
        const res = acceptOffer(s.game, playerId, teamId);
        notice = res.ok
          ? { ok: true, message: `Vendiste a ${res.player.name} a ${res.from} por $ ${res.price.toLocaleString('es-AR')}.` }
          : { ok: false, message: res.reason };
      });
      void get().persist();
      return notice;
    },

    rejectOffer(playerId, teamId) {
      set((s) => {
        if (s.game) rejectOffer(s.game, playerId, teamId);
      });
      void get().persist();
    },

    toggleWatch(playerId) {
      let notice: MarketNotice = { ok: false, message: 'No hay partida.' };
      set((s) => {
        if (!s.game) return;
        const res = toggleWatch(s.game, playerId);
        notice = res.ok ? { ok: true, message: res.watching ? 'Agregado a la cartera.' : 'Quitado de la cartera.' } : { ok: false, message: res.reason };
      });
      void get().persist();
      return notice;
    },

    toggleTraining(playerId) {
      return runTeamAction((team) => toggleTraining(team, playerId));
    },

    setTrainingIntensity(playerId, intensity) {
      return runTeamAction((team) => setTrainingIntensity(team, playerId, intensity));
    },

    upgradeTrainingFacility() {
      return runTeamAction((team, g) => {
        const res = upgradeTrainingFacility(team, offMatchday(g));
        if (res.ok) pushNews(g, `🏋️ Mejoraste el centro de entrenamiento: nivel ${team.trainingFacility}.`);
        return res;
      });
    },

    upgradeAcademy() {
      return runTeamAction((team, g) => {
        const res = upgradeAcademy(team, offMatchday(g));
        if (res.ok) pushNews(g, `🌱 Mejoraste el centro juvenil: nivel ${team.academyFacility}.`);
        return res;
      });
    },

    promoteYouth(playerId) {
      return runTeamAction((team, g) => {
        const rng = createRng(g.rngState);
        const name = team.academy.find((p) => p.id === playerId)?.name ?? 'El juvenil';
        const res = promoteYouth(team, playerId, rng);
        g.rngState = rng.state();
        if (res.ok) pushNews(g, `⬆️ ${name} subió al primer equipo.`);
        return res;
      });
    },

    demoteToAcademy(playerId) {
      return runTeamAction((team) => demoteToAcademy(team, playerId));
    },

    sellYouth(playerId) {
      return runTeamAction((team, g) => {
        const name = team.academy.find((p) => p.id === playerId)?.name ?? 'el juvenil';
        const res = sellYouth(team, playerId, offMatchday(g));
        if (res.ok) pushNews(g, `💰 Vendiste a ${name} por $ ${(-res.cost).toLocaleString('es-AR')}.`);
        return res;
      });
    },

    setDtName(name) {
      set((s) => {
        if (s.game) renameDt(s.game, name);
      });
      void get().persist();
    },

    setDtAge(age) {
      set((s) => {
        if (s.game) setDtAge(s.game, age);
      });
      void get().persist();
    },

    acceptJobOffer(teamId) {
      let error: string | null = null;
      set((s) => {
        if (!s.game || s.live) {
          error = 'No se puede cambiar de club en este momento.';
          return;
        }
        const res = acceptJobOffer(s.game, teamId);
        if (!res.ok) error = res.reason;
        else s.tab = 'home';
      });
      if (!error) void get().persist();
      return error;
    },

    rejectJobOffer(teamId) {
      set((s) => {
        if (s.game) rejectJobOffer(s.game, teamId);
      });
      void get().persist();
    },

    async waitForOffers() {
      set((s) => {
        if (s.game && !s.live) waitForOffers(s.game);
      });
      await get().persist();
    },
  })),
);

/** Acción del usuario sobre su equipo: aplica `fn`, y si sale bien guarda; devuelve el error (o null). */
function runTeamAction(fn: (team: Team, g: GameState) => ActionResult): string | null {
  let error: string | null = null;
  useGame.setState((s) => {
    const team = s.game && userTeam(s.game);
    if (!s.game || !team) return;
    const res = fn(team, s.game);
    if (!res.ok) error = res.reason;
  });
  if (!error) void useGame.getState().persist();
  return error;
}

onLogout(() => useGame.getState().reset());
