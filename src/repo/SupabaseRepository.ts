import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from '../domain/types';
import type { GameRepository, SaveSummary } from './GameRepository';
import { parseSave } from './saveSchema';

/**
 * Implementación real sobre la tabla `saves` (ver supabase/migrations/0001_saves.sql).
 * Requiere un usuario autenticado: las políticas RLS filtran por auth.uid().
 * Todavía no está activa; se habilita con VITE_DATA_SOURCE=supabase.
 */
export class SupabaseRepository implements GameRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async listSaves(): Promise<SaveSummary[]> {
    const { data, error } = await this.client
      .from('saves')
      .select('slot, team_name, season, updated_at')
      .order('slot');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      slot: r.slot, teamName: r.team_name, season: r.season, updatedAt: r.updated_at,
    }));
  }

  async load(slot: number): Promise<GameState | null> {
    const { data, error } = await this.client.from('saves').select('state').eq('slot', slot).maybeSingle();
    if (error) throw error;
    return data ? parseSave(data.state) : null;
  }

  async save(slot: number, state: GameState): Promise<void> {
    const team = Object.values(state.divisions).flatMap((d) => d.teams).find((t) => t.id === state.userTeamId);
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) throw new Error('Hay que iniciar sesión para guardar');
    const { error } = await this.client.from('saves').upsert(
      {
        user_id: auth.user.id, slot, version: state.version, season: state.season,
        team_name: team?.name ?? null, state,
      },
      { onConflict: 'user_id,slot' },
    );
    if (error) throw error;
  }

  async remove(slot: number): Promise<void> {
    const { error } = await this.client.from('saves').delete().eq('slot', slot);
    if (error) throw error;
  }
}
