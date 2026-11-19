import type { MatchResult, Team, TeamRecord } from '../domain/types';
import { LEAGUE } from './config';

export function emptyRecord(): TeamRecord {
  return { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
}

function apply(rec: TeamRecord, gf: number, ga: number) {
  rec.played++;
  rec.gf += gf;
  rec.ga += ga;
  if (gf > ga) {
    rec.w++;
    rec.pts += LEAGUE.pointsWin;
  } else if (gf < ga) {
    rec.l++;
  } else {
    rec.d++;
    rec.pts += LEAGUE.pointsDraw;
  }
}

/** Actualiza el récord de ambos equipos (muta). */
export function applyResult(home: Team, away: Team, r: MatchResult): void {
  apply(home.record, r.hg, r.ag);
  apply(away.record, r.ag, r.hg);
}

/** Tabla ordenada por puntos, diferencia de gol, goles a favor y nombre. */
export function standings(teams: Team[]): Team[] {
  return [...teams].sort(
    (a, b) =>
      b.record.pts - a.record.pts ||
      b.record.gf - b.record.ga - (a.record.gf - a.record.ga) ||
      b.record.gf - a.record.gf ||
      a.name.localeCompare(b.name, 'es'),
  );
}
