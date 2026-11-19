import type { GameState } from '../domain/types';
import type { GameRepository, SaveSummary } from './GameRepository';
import { parseSave } from './saveSchema';

/**
 * Repositorio de desarrollo: guarda en localStorage (o en memoria si no hay localStorage),
 * con una latencia simulada para que la UI ya maneje estados de carga como con Supabase.
 */
export class MockRepository implements GameRepository {
  private memory = new Map<string, string>();
  private readonly prefix = 'futsal-manager:save:';
  private readonly latencyMs: number;

  constructor(latencyMs = 150) {
    this.latencyMs = latencyMs;
  }

  private delay() {
    return new Promise((r) => setTimeout(r, this.latencyMs));
  }

  private get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  private set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      if (value === null) this.memory.delete(key);
      else this.memory.set(key, value);
    }
  }

  async listSaves(): Promise<SaveSummary[]> {
    await this.delay();
    const out: SaveSummary[] = [];
    for (let slot = 1; slot <= 3; slot++) {
      const raw = this.get(this.prefix + slot);
      if (!raw) continue;
      try {
        const { summary } = JSON.parse(raw) as { summary: SaveSummary };
        out.push(summary);
      } catch {
        /* guardado corrupto: se ignora */
      }
    }
    return out;
  }

  async load(slot: number): Promise<GameState | null> {
    await this.delay();
    const raw = this.get(this.prefix + slot);
    if (!raw) return null;
    try {
      return parseSave(JSON.parse(raw).state);
    } catch {
      return null;
    }
  }

  async save(slot: number, state: GameState): Promise<void> {
    await this.delay();
    const team = Object.values(state.divisions)
      .flatMap((d) => d.teams)
      .find((t) => t.id === state.userTeamId);
    const summary: SaveSummary = {
      slot,
      teamName: team?.name ?? '—',
      season: state.season,
      updatedAt: new Date().toISOString(),
    };
    this.set(this.prefix + slot, JSON.stringify({ summary, state }));
  }

  async remove(slot: number): Promise<void> {
    await this.delay();
    this.set(this.prefix + slot, null);
  }
}
