import { z } from 'zod';
import type { GameState } from '../domain/types';
import { buildCalendar, indexAfterLeagueRounds } from '../engine/calendar';
import { COMPETITIONS } from '../engine/config';
import { createFinance, defaultStaff, sponsorFromRating } from '../engine/finance';
import { defaultYouthFields, initialAcademy, newDtProfile } from '../engine/generate';
import { emptyMarket } from '../engine/world';

export const CURRENT_SAVE_VERSION = 6;

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

/**
 * v2 → v3: economía y staff. Completa lo mismo que generate.ts, sin azar: sponsor de origen según el nivel
 * del plantel, entrada según la división, 1 preparador, sin historial y sin ofertas pendientes.
 */
export function migrateV2toV3(s: Obj): Obj {
  const divisions = { ...(s.divisions as Obj) };
  for (const id of ['A', 'B', 'C'] as const) {
    const div = divisions[id] as Obj | undefined;
    if (!div || !Array.isArray(div.teams)) continue;
    divisions[id] = {
      ...div,
      teams: (div.teams as Obj[]).map((t) => {
        const squad = (t.squad as { rating?: number }[] | undefined) ?? [];
        const avg = squad.length ? squad.reduce((a, p) => a + (p.rating ?? 55), 0) / squad.length : 55;
        return {
          ...t,
          finance: t.finance ?? createFinance(id, sponsorFromRating(avg)),
          staff: t.staff ?? defaultStaff(),
        };
      }),
    };
  }
  return { ...s, divisions, sponsorOffers: s.sponsorOffers ?? null };
}

/**
 * v3 → v4: mercado de pases. Sin pretemporada (la partida ya estaba en curso), mercado vacío (se arma en el primer
 * `tickMarket` al cargar), cartera vacía e historial h2h vacío (el clásico aparece tras 3 partidos nuevos).
 */
export function migrateV3toV4(s: Obj): Obj {
  return {
    ...s,
    preseasonWeeksLeft: typeof s.preseasonWeeksLeft === 'number' ? s.preseasonWeeksLeft : 0,
    market: s.market ?? emptyMarket(),
    watchlist: Array.isArray(s.watchlist) ? s.watchlist : [],
    h2h: s.h2h ?? {},
  };
}

/**
 * v4 → v5: competiciones. Las divisiones pasan a tener fase/playoff/ascenso directo/descensos (en 'regular', sin nada
 * armado) y la partida gana calendario, copas, historial, objetivo y títulos.
 *
 * Una partida a mitad de temporada no permite reconstruir qué se habría jugado de la copa: se arma el calendario
 * intercalado con las fechas de liga ya jugadas como hechas (el índice queda justo después de la última) y
 *  - si todavía no pasó la primera ronda de copa (fecha de liga <= 5), la copa se juega completa esta temporada
 *    (la sortea `ensureCompetitions` al cargar);
 *  - si ya pasaron rondas, las copas de esas rondas quedan como NO disputadas esta temporada (sin copa ni pasos de copa).
 * No hay Copa Internacional esta temporada (nadie clasificó). Si la liga ya terminó (fecha 34), los playoffs se arman
 * al cargar. La próxima temporada arranca con todo el formato nuevo.
 */
export function migrateV4toV5(s: Obj): Obj {
  const divisions = { ...(s.divisions as Obj) };
  for (const id of ['A', 'B', 'C']) {
    const div = divisions[id] as Obj | undefined;
    if (!div) continue;
    divisions[id] = { ...div, phase: div.phase ?? 'regular', playoff: div.playoff ?? null, promotedDirect: div.promotedDirect ?? null, relegated: div.relegated ?? null };
  }
  const a = divisions.A as { matchday?: number; schedule?: unknown[] } | undefined;
  const leagueRounds = a?.schedule?.length || 34;
  const played = Math.min(a?.matchday ?? 0, leagueRounds);
  const cupStillOn = played <= COMPETITIONS.cupInsertAfter[0];
  const calendar = buildCalendar({ leagueRounds, cup: cupStillOn, intl: false });
  return {
    ...s,
    divisions,
    calendar,
    calendarIndex: indexAfterLeagueRounds(calendar, played),
    cup: null,
    intlCup: null,
    intlGuestTeams: {},
    intlCupQualifiedNextSeason: null,
    championsCup: null,
    championsHistory: [],
    lastSeasonAStandings: null,
    objective: null,
    seasonHistory: [],
    titles: [],
  };
}

/**
 * v5 → v6: cantera, entrenamiento y DT. Cada equipo recibe una cantera generada de forma determinista a partir de su id
 * (sin tocar el rng de la partida; los invitados de la Internacional no tienen), centros en nivel 0 y entrenamiento vacío.
 * El perfil del DT arranca con el récord en cero (los partidos viejos no se pueden reconstruir) y, si ya tenía club, con un
 * paso abierto por él; las temporadas cerradas salen del historial. Los títulos viejos no llevan club: se le atribuyen a ese.
 */
export function migrateV5toV6(s: Obj): Obj {
  const divisions = { ...(s.divisions as Obj) };
  const names = new Map<string, string>();
  for (const id of ['A', 'B', 'C'] as const) {
    const div = divisions[id] as Obj | undefined;
    if (!div || !Array.isArray(div.teams)) continue;
    divisions[id] = {
      ...div,
      teams: (div.teams as Obj[]).map((t) => {
        names.set(t.id as string, t.name as string);
        const y = defaultYouthFields([]);
        return {
          ...t,
          academy: Array.isArray(t.academy) ? t.academy : initialAcademy(t.id as string, id),
          academyFacility: t.academyFacility ?? y.academyFacility,
          trainingFacility: t.trainingFacility ?? y.trainingFacility,
          training: Array.isArray(t.training) ? t.training : y.training,
          trainingIntensity: t.trainingIntensity ?? y.trainingIntensity,
        };
      }),
    };
  }
  const guests = Object.fromEntries(
    Object.entries((s.intlGuestTeams as Obj | undefined) ?? {}).map(([k, t]) => [k, { ...(t as Obj), ...defaultYouthFields([]) }]),
  );
  const history = Array.isArray(s.seasonHistory) ? (s.seasonHistory as { season: number }[]) : [];
  const dt = newDtProfile(typeof s.seed === 'number' ? s.seed : 1);
  dt.career.seasons = history.length;
  const userId = s.userTeamId as string | null;
  if (userId && names.has(userId)) {
    dt.tenures.push({
      teamId: userId,
      teamName: names.get(userId) as string,
      fromSeason: history[0]?.season ?? (s.season as number),
      toSeason: null,
      matches: 0, wins: 0, draws: 0, losses: 0,
      seasons: history.length,
    });
  }
  return { ...s, divisions, intlGuestTeams: guests, dt: s.dt ?? dt };
}

const MIGRATIONS: Record<number, (s: Obj) => Obj> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
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
