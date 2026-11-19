import { createClient } from '@supabase/supabase-js';
import type { GameRepository } from './GameRepository';
import { MockRepository } from './MockRepository';
import { SupabaseRepository } from './SupabaseRepository';

function createRepository(): GameRepository {
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock';
  if (source === 'supabase') {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
    return new SupabaseRepository(createClient(url, key));
  }
  return new MockRepository();
}

export const repository: GameRepository = createRepository();
export type { GameRepository, SaveSummary } from './GameRepository';
