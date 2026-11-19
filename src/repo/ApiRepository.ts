import { api, ApiError } from '../api/client';
import type { GameState } from '../domain/types';
import type { GameRepository, SaveSummary } from './GameRepository';
import { parseSave } from './saveSchema';

/** Partidas del usuario logueado, guardadas en Postgres a través de la API (server/routes/saves.ts). */
export class ApiRepository implements GameRepository {
  async listSaves(): Promise<SaveSummary[]> {
    const { saves } = await api<{ saves: SaveSummary[] }>('GET', '/saves');
    return saves;
  }

  async load(slot: number): Promise<GameState | null> {
    try {
      const { state } = await api<{ state: unknown }>('GET', `/saves/${slot}`);
      return parseSave(state);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  async save(slot: number, state: GameState): Promise<void> {
    const team = Object.values(state.divisions)
      .flatMap((d) => d.teams)
      .find((t) => t.id === state.userTeamId);
    await api('PUT', `/saves/${slot}`, { teamName: team?.name ?? null, state });
  }

  async remove(slot: number): Promise<void> {
    await api('DELETE', `/saves/${slot}`);
  }
}
