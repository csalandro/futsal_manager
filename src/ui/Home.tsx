import type { GameState, Team } from '../domain/types';
import { matchOdds } from '../engine/match';
import { lineupIssues } from '../engine/squad';
import { isSeasonOver, userNextFixture, userTeam } from '../engine/season';
import { standings } from '../engine/standings';
import { teamStrength } from '../engine/strength';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';
import { pct } from './format';
import { IconTable } from './icons';

type Outcome = 'G' | 'E' | 'P';

/** Últimos resultados del usuario, del más viejo al más nuevo. */
function recentForm(game: GameState, teamId: string, n = 5): { outcome: Outcome; score: string; rival: string }[] {
  const div = game.divisions[game.userDivision!];
  const names = new Map(div.teams.map((t) => [t.id, t.name]));
  const out: { outcome: Outcome; score: string; rival: string }[] = [];
  for (const round of div.results) {
    const r = round.find((m) => m.homeId === teamId || m.awayId === teamId);
    if (!r) continue;
    const home = r.homeId === teamId;
    const mine = home ? r.hg : r.ag;
    const theirs = home ? r.ag : r.hg;
    out.push({
      outcome: mine > theirs ? 'G' : mine < theirs ? 'P' : 'E',
      score: `${mine}-${theirs}`,
      rival: names.get(home ? r.awayId : r.homeId) ?? '',
    });
  }
  return out.slice(-n);
}

function MiniTable({ teams, me, divId }: { teams: Team[]; me: string; divId: string }) {
  const setTab = useGame((s) => s.setTab);
  const rows = standings(teams);
  const idx = rows.findIndex((t) => t.id === me);
  const start = Math.max(0, Math.min(idx - 2, rows.length - 5));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>División {divId}</h2>
        <button type="button" className="link" onClick={() => setTab('table')}>
          <IconTable size={16} /> Ver tabla
        </button>
      </header>
      <table className="grid compact">
        <thead>
          <tr>
            <th className="num">#</th>
            <th className="left">Equipo</th>
            <th className="num">PJ</th>
            <th className="num">DG</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(start, start + 5).map((t) => (
            <tr key={t.id} className={t.id === me ? 'me' : ''}>
              <td className="num">{rows.indexOf(t) + 1}</td>
              <td className="left">
                <span className="team-cell">
                  <Badge name={t.name} color={t.color} size="sm" />
                  {t.name}
                </span>
              </td>
              <td className="num">{t.record.played}</td>
              <td className="num">{t.record.gf - t.record.ga}</td>
              <td className="num strong">{t.record.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Home() {
  const game = useGame((s) => s.game);
  const busy = useGame((s) => s.busy);
  const startUserMatch = useGame((s) => s.startUserMatch);
  const quickPlayMatchday = useGame((s) => s.quickPlayMatchday);
  const nextSeason = useGame((s) => s.nextSeason);
  const autoLineup = useGame((s) => s.autoLineup);
  const setTab = useGame((s) => s.setTab);
  if (!game || !game.userDivision || !game.userTeamId) return null;
  const team = userTeam(game);
  if (!team) return null;

  const issues = lineupIssues(team);
  const blocked = issues.length > 0;
  const over = isSeasonOver(game);
  const fx = over ? null : userNextFixture(game);
  const odds = fx ? matchOdds(fx.home, fx.away) : null;
  const table = standings(game.divisions[game.userDivision].teams);
  const pos = table.findIndex((t) => t.id === game.userTeamId) + 1;
  const form = recentForm(game, game.userTeamId);
  const topScorer = [...team.squad].sort((a, b) => b.stats.goals - a.stats.goals)[0];

  return (
    <div className="dash">
      {over ? (
        <section className="panel hero span-2">
          <div className="season-end">
            <span className="trophy" aria-hidden="true">
              🏆
            </span>
            <div>
              <h2>Temporada {game.season} terminada</h2>
              <p>
                Terminaste <b>{pos}º</b> de {table.length} en la División {game.userDivision}.
              </p>
            </div>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void nextSeason()}>
              Siguiente temporada
            </button>
          </div>
        </section>
      ) : fx && odds ? (
        <section className="panel hero span-2">
          <header className="panel-head">
            <h2>Próximo partido</h2>
            <span className="tag">Fecha {fx.matchday + 1}</span>
          </header>
          <div className="fixture-hero">
            <div className="fh-team">
              <Badge name={fx.home.name} color={fx.home.color} size="xl" />
              <strong>{fx.home.name}</strong>
              <span className="muted">Local · Fuerza {Math.round(teamStrength(fx.home))}</span>
            </div>
            <div className="fh-vs">
              <span>VS</span>
              <small>
                xG {odds.xg.home.toFixed(1)} – {odds.xg.away.toFixed(1)}
              </small>
            </div>
            <div className="fh-team">
              <Badge name={fx.away.name} color={fx.away.color} size="xl" />
              <strong>{fx.away.name}</strong>
              <span className="muted">Visitante · Fuerza {Math.round(teamStrength(fx.away))}</span>
            </div>
          </div>
          <div className="odds-bar" role="img" aria-label={`Probabilidades: local ${pct(odds.home)}, empate ${pct(odds.draw)}, visitante ${pct(odds.away)}`}>
            <span className="ob-home" style={{ flexGrow: odds.home }}>
              {pct(odds.home)}
            </span>
            <span className="ob-draw" style={{ flexGrow: odds.draw }}>
              {pct(odds.draw)}
            </span>
            <span className="ob-away" style={{ flexGrow: odds.away }}>
              {pct(odds.away)}
            </span>
          </div>
          <div className="odds-legend">
            <span>Gana local</span>
            <span>Empate</span>
            <span>Gana visitante</span>
          </div>
          {blocked && (
            <div className="lineup-problems" role="alert">
              <strong>No podés jugar con esta alineación:</strong>
              <ul>
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <div className="actions">
                <button type="button" className="btn small primary" onClick={autoLineup}>
                  Autocompletar alineación
                </button>
                <button type="button" className="btn small" onClick={() => setTab('tactics')}>
                  Ir a Tácticas
                </button>
              </div>
            </div>
          )}
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy || blocked} onClick={startUserMatch}>
              Jugar en vivo
            </button>
            <button type="button" className="btn" disabled={busy || blocked} onClick={() => void quickPlayMatchday()}>
              Simular fecha
            </button>
          </div>
        </section>
      ) : (
        <section className="panel span-2">
          <p className="empty">No hay partido pendiente.</p>
        </section>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>Estado del club</h2>
        </header>
        <dl className="kv">
          <div>
            <dt>Posición</dt>
            <dd>
              {pos}º <small className="muted">de {table.length}</small>
            </dd>
          </div>
          <div>
            <dt>Puntos</dt>
            <dd>{team.record.pts}</dd>
          </div>
          <div>
            <dt>Moral</dt>
            <dd>
              <div className="meter" role="img" aria-label={`Moral ${team.morale} de 100`}>
                <i style={{ width: `${team.morale}%` }} className={team.morale >= 65 ? 'good' : team.morale >= 40 ? 'mid' : 'bad'} />
              </div>
            </dd>
          </div>
          <div>
            <dt>Fuerza</dt>
            <dd>{Math.round(teamStrength(team))}</dd>
          </div>
          <div>
            <dt>Goleador</dt>
            <dd className="ellipsis">{topScorer && topScorer.stats.goals > 0 ? `${topScorer.name} (${topScorer.stats.goals})` : '—'}</dd>
          </div>
          <div>
            <dt>Forma</dt>
            <dd>
              {form.length === 0 ? (
                <span className="muted">—</span>
              ) : (
                <span className="form">
                  {form.map((f, i) => (
                    <span key={i} className={`fpill f-${f.outcome}`} title={`${f.score} vs ${f.rival}`}>
                      {f.outcome}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <MiniTable teams={game.divisions[game.userDivision].teams} me={game.userTeamId} divId={game.userDivision} />

      <section className="panel span-2">
        <header className="panel-head">
          <h2>Bandeja de entrada</h2>
          <span className="tag">{game.news.length}</span>
        </header>
        {game.news.length === 0 ? (
          <p className="empty">Todavía no hay noticias.</p>
        ) : (
          <ul className="inbox">
            {game.news.slice(0, 8).map((n, i) => (
              <li key={i} className={i === 0 ? 'unread' : ''}>
                <span className="inbox-dot" aria-hidden="true" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
