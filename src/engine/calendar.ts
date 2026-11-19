// Calendario intercalado de la temporada como lista de "pasos". Port de buildCalendar (HTML 852-870).
// Módulo puro (solo tipos y config) para que lo use también la migración del guardado.
//
// Mercado de pases: el "día" sigue siendo la fecha de liga (matchday + 1; ver config MARKET). Las rondas de copa se
// juegan entre dos fechas y no mueven el día, así que las ventanas no cambian; `tickMarket` usa la clave
// temporada:matchday:pretemporada, por lo que llamarlo tras cada paso (de liga o no) es idempotente.
import type { CalendarStep } from '../domain/types';
import { COMPETITIONS } from './config';

export interface CalendarOptions {
  /** Fechas de liga (34 con 18 equipos a doble rueda). */
  leagueRounds: number;
  /** Incluye las 6 rondas de la copa nacional. */
  cup: boolean;
  /** Incluye las 6 fechas de la Copa Internacional (solo si hay clasificado). */
  intl: boolean;
}

/**
 * Liga + copa tras las fechas 5, 10, 15, 20, 25 y 29 (HTML 850) + Internacional tras la 3, 8, 13, 18, 23 y 28 (HTML 851),
 * y al final los playoffs (cuartos, semis, final) y la Copa de Campeones (semis y final), que en el original arrancan
 * cuando todas las divisiones terminaron la fase regular (HTML 1729-1749, 1851).
 */
export function buildCalendar(opts: CalendarOptions): CalendarStep[] {
  const cupAfter = new Set<number>(COMPETITIONS.cupInsertAfter);
  const intlAfter = new Set<number>(COMPETITIONS.intlInsertAfter);
  const steps: CalendarStep[] = [];
  let cupIdx = 0, intlIdx = 0;
  for (let i = 0; i < opts.leagueRounds; i++) {
    steps.push({ kind: 'league', round: i });
    if (opts.cup && cupAfter.has(i + 1) && cupIdx < 6) steps.push({ kind: 'cup', round: cupIdx++ });
    if (opts.intl && intlAfter.has(i + 1) && intlIdx < 6) steps.push({ kind: 'intl', round: intlIdx++ });
  }
  steps.push({ kind: 'playoff', stage: 'QF' }, { kind: 'playoff', stage: 'SF' }, { kind: 'playoff', stage: 'F' });
  steps.push({ kind: 'champions', stage: 'SF' }, { kind: 'champions', stage: 'F' });
  return steps;
}

/**
 * Índice del paso que sigue tras `leagueDone` fechas de liga jugadas: justo después de la última fecha hecha
 * (como initCup, HTML 922-928), de modo que una ronda de copa que toca a continuación no se saltea.
 */
export function indexAfterLeagueRounds(calendar: CalendarStep[], leagueDone: number): number {
  let idx = 0, seen = 0;
  while (seen < leagueDone && idx < calendar.length) {
    if (calendar[idx].kind === 'league') seen++;
    idx++;
  }
  return idx;
}

const INTL_LABELS = ['Fase de grupos · fecha 1', 'Fase de grupos · fecha 2', 'Fase de grupos · fecha 3', 'Cuartos de final', 'Semifinal', 'Final'];
const PLAYOFF_LABELS = { QF: 'Cuartos de final', SF: 'Semifinal', F: 'Final' } as const;

export function intlRoundLabel(round: number): string {
  return INTL_LABELS[round] ?? `Ronda ${round + 1}`;
}

export function playoffStageLabel(stage: 'QF' | 'SF' | 'F'): string {
  return PLAYOFF_LABELS[stage];
}

/** Nombre corto del paso, para la UI y los mensajes. */
export function stepLabel(step: CalendarStep): string {
  switch (step.kind) {
    case 'league':
      return `Liga · fecha ${step.round + 1}`;
    case 'cup':
      return `Copa · ${COMPETITIONS.cupStageLabels[step.round] ?? `ronda ${step.round + 1}`}`;
    case 'intl':
      return `Copa Internacional · ${intlRoundLabel(step.round)}`;
    case 'playoff':
      return `Playoffs · ${PLAYOFF_LABELS[step.stage]}`;
    case 'champions':
      return `Copa de Campeones · ${step.stage === 'SF' ? 'Semifinal' : 'Final'}`;
  }
}
