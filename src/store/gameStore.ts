import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GameState, Tactic } from '../domain/types';
import { createNewGame } from '../engine/generate';
import { simulateMatch, type SimulatedMatch } from '../engine/match';
import { createRng, randomSeed } from '../engine/rng';
import { isSeasonOver, playMatchday, startNewSeason, userNextFixture, userTeam } from '../engine/season';
import { repository, type SaveSummary } from '../repo';
import { onLogout } from './authStore';

export type Screen = 'menu' | 'pickTeam' | 'game' | 'admin';
export type Tab = 'home' | 'squad' | 'tactics' | 'table' | 'fixture';

export interface LiveMatch {
  sim: SimulatedMatch;
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

  /** Simula el partido del usuario y abre el relato en vivo (el resultado ya está decidido). */
  startUserMatch(): void;
  /** Cierra el relato y juega el resto de la fecha. */
  finishUserMatch(): Promise<void>;
  /** Juega la fecha sin ver el partido. */
  quickPlayMatchday(): Promise<void>;
  nextSeason(): Promise<void>;

  setLineupSlot(index: number, playerId: string | null): void;
  setTactic(patch: Partial<Tactic>): void;
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
        s.screen = 'game';
      });
      await get().persist();
    },

    async loadGame(slot) {
      set({ busy: true, error: null });
      try {
        const game = await repository.load(slot);
        if (!game) throw new Error('No se pudo cargar la partida (vacía o de una versión incompatible)');
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
        if (!s.game) return;
        const fx = userNextFixture(s.game);
        if (!fx) return;
        const rng = createRng(s.game.rngState);
        const sim = simulateMatch(fx.home, fx.away, rng);
        s.game.rngState = rng.state();
        s.live = { sim, homeName: fx.home.name, awayName: fx.away.name, userIsHome: fx.home.id === s.game.userTeamId };
      });
    },

    async finishUserMatch() {
      set((s) => {
        if (!s.game || !s.live) return;
        playMatchday(s.game, s.live.sim);
        s.live = null;
      });
      await get().persist();
    },

    async quickPlayMatchday() {
      set((s) => {
        if (s.game) playMatchday(s.game);
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
  })),
);

onLogout(() => useGame.getState().reset());
