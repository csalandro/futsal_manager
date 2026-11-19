import { z } from 'zod';
import type { GameState } from '../domain/types';

export const CURRENT_SAVE_VERSION = 2;

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
type Obj = Record<string, unknown>;

/** v1 → v2: lesiones, suspensiones, amarillas acumuladas y pateadores de penales. */
export function migrateV1toV2(s: Obj): Obj {
  const divisions = { ...(s.divisions as Obj) };
  for (const id of ['A', 'B', 'C']) {
    const div = divisions[id] as Obj | undefined;
    if (!div || !Array.isArray(div.teams)) continue;
    divisions[id] = {
      ...div,
      teams: (div.teams as Obj[]).map((t) => ({
        ...t,
        penaltyTakers: Array.isArray(t.penaltyTakers) ? t.penaltyTakers : [],
        squad: ((t.squad as Obj[]) ?? []).map((p) => ({
          ...p,
          injury: p.injury ?? null,
          suspension: typeof p.suspension === 'number' ? p.suspension : 0,
          yellowAccum: typeof p.yellowAccum === 'number' ? p.yellowAccum : 0,
        })),
      })),
    };
  }
  return { ...s, divisions };
}

const MIGRATIONS: Record<number, (s: Obj) => Obj> = {
  1: migrateV1toV2,
};

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
