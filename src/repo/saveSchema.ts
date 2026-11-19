import { z } from 'zod';
import type { GameState } from '../domain/types';

export const CURRENT_SAVE_VERSION = 1;

// Validación superficial: versión y forma general. El detalle lo garantiza TypeScript al escribir.
const saveEnvelope = z
  .object({
    version: z.number().int(),
    seed: z.number(),
    rngState: z.number(),
    season: z.number().int(),
    userTeamId: z.string().nullable(),
    divisions: z.object({ A: z.any(), B: z.any(), C: z.any() }),
  })
  .passthrough();

/** Migraciones: version N → N+1. Agregar una entrada cada vez que cambie GameState. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseSave(raw: unknown): GameState | null {
  const parsed = saveEnvelope.safeParse(raw);
  if (!parsed.success) {
    console.warn('Guardado inválido', parsed.error.issues);
    return null;
  }
  let data: Record<string, unknown> = parsed.data;
  while ((data.version as number) < CURRENT_SAVE_VERSION) {
    const migrate = MIGRATIONS[data.version as number];
    if (!migrate) return null;
    data = { ...migrate(data), version: (data.version as number) + 1 };
  }
  if ((data.version as number) > CURRENT_SAVE_VERSION) return null;
  return data as unknown as GameState;
}
