import type { GameState, Tie } from '../domain/types';
import { tieWinner } from '../engine/competitions';
import { findTeam } from '../engine/season';
import { Badge } from './Badge';

/** Lista de cruces a partido único (copas y playoffs), legible en 375px: nombre, marcador (y penales) y nombre. */
export function TieList({ game, ties, onlyMine = false }: { game: GameState; ties: Tie[]; onlyMine?: boolean }) {
  const me = game.userTeamId;
  const rows = onlyMine ? ties.filter((t) => t.home === me || t.away === me) : ties;
  if (rows.length === 0) return null;
  return (
    <ul className="tie-list">
      {rows.map((t) => {
        const home = findTeam(game, t.home), away = findTeam(game, t.away);
        const w = tieWinner(t);
        const r = t.result;
        const mine = t.home === me || t.away === me;
        return (
          <li key={t.home + t.away} className={mine ? 'me' : ''}>
            <span className={`t-home${w === t.home ? ' t-win' : ''}`} title={home?.name}>
              {home?.name ?? t.home}
            </span>
            <span className={`tie-score${r ? '' : ' pending'}`}>
              {r ? `${r.hg} – ${r.ag}` : 'vs'}
              {r?.penalties && (
                <small>
                  pen. {r.penalties.home}-{r.penalties.away}
                </small>
              )}
            </span>
            <span className={`t-away${w === t.away ? ' t-win' : ''}`} title={away?.name}>
              {away?.name ?? t.away}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TeamName({ game, id }: { game: GameState; id: string | null }) {
  const t = id ? findTeam(game, id) : undefined;
  if (!t) return <span className="muted">—</span>;
  return (
    <span className="team-cell">
      <Badge name={t.name} color={t.color} size="sm" />
      {t.name}
    </span>
  );
}
