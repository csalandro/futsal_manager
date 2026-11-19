import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GameState, StaffKey, Tactic } from '../domain/types';
import type { StadiumUpgradeKey } from '../engine/config';
import {
  chooseSponsorOffer, ensureSponsorOffers, fireStaff, hireStaff, medicalLevels, recordMovement, renameStadium,
  setTicketPrice, upgradeStadium, type FinanceCtx,
} from '../engine/finance';
import { createNewGame } from '../engine/generate';
import { composeMatch, simulateHalf, type HalfResult, type SimulatedMatch } from '../engine/match';
import { createRng, randomSeed } from '../engine/rng';
import { isSeasonOver, playMatchday, pushNews, startNewSeason, userNextFixture, userTeam } from '../engine/season';
import {
  bestAvailableFive, firePlayer, lineupIssues, movePenaltyTaker, renewContract, setPlayerNumber, togglePenaltyTaker,
} from '../engine/squad';
import { repository, type SaveSummary } from '../repo';
import { onLogout } from './authStore';

export type Screen = 'menu' | 'pickTeam' | 'game' | 'admin';
export type Tab = 'home' | 'squad' | 'tactics' | 'table' | 'fixture' | 'club';

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

  refreshSaves(): Promise<void>;
  newGame(dtName: string, slot: number): void;
  pickTeam(teamId: string): Promise<void>;
  loadGame(slot: number): Promise<void>;
  deleteSave(slot: number): Promise<void>;
  persist(): Promise<void>;
  setTab(tab: Tab): void;
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
  /** Juega la fecha sin ver el partido. */
  quickPlayMatchday(): Promise<void>;
  nextSeason(): Promise<void>;

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
        ensureSponsorOffers(s.game);
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
        set({ game, slot, screen: game.userTeamId ? 'game' : 'pickTeam', tab: 'home', live: null });
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
        if (!s.game || s.live) return;
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
          homeName: fx.home.name, awayName: fx.away.name, userIsHome,
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
        s.live.sim = composeMatch(fx.home, fx.away, s.live.half1, second, rng);
        s.game.rngState = rng.state();
      });
      void get().persist();
    },

    async finishUserMatch() {
      set((s) => {
        if (!s.game || !s.live?.sim) return;
        playMatchday(s.game, s.live.sim);
        s.live = null;
      });
      await get().persist();
    },

    async quickPlayMatchday() {
      set((s) => {
        const me = s.game && userTeam(s.game);
        if (s.game && me && lineupIssues(me).length === 0) playMatchday(s.game);
      });
      await get().persist();
    },

    async nextSeason() {
      set((s) => {
        if (s.game && isSeasonOver(s.game)) startNewSeason(s.game);
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
  })),
);

onLogout(() => useGame.getState().reset());
