import type { GameState } from '../domain/types';

export interface SaveSummary {
  slot: number;
  teamName: string;
  season: number;
  updatedAt: string;
}

/**
 * Acceso a datos del juego. La app solo conoce esta interfaz; la implementación
 * (mock en el navegador o Supabase) se elige en src/repo/index.ts.
 */
export interface GameRepository {
  listSaves(): Promise<SaveSummary[]>;
  load(slot: number): Promise<GameState | null>;
  save(slot: number, state: GameState): Promise<void>;
  remove(slot: number): Promise<void>;
}
