import { matchOdds } from '../engine/match';
import { isSeasonOver, userNextFixture } from '../engine/season';
import { standings } from '../engine/standings';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';
import { pct } from './format';

export function Home() {
  const game = useGame((s) => s.game);
  const busy = useGame((s) => s.busy);
  const startUserMatch = useGame((s) => s.startUserMatch);
  const quickPlayMatchday = useGame((s) => s.quickPlayMatchday);
  const nextSeason = useGame((s) => s.nextSeason);
  if (!game || !game.userDivision) return null;

  const over = isSeasonOver(game);
  const fx = over ? null : userNextFixture(game);
  const odds = fx ? matchOdds(fx.home, fx.away) : null;
  const table = standings(game.divisions[game.userDivision].teams);
  const pos = table.findIndex((t) => t.id === game.userTeamId) + 1;

  return (
    <>
      {over ? (
        <section className="hero">
          <img className="trophy" src="/pixel/trophy.png" alt="" aria-hidden="true" />
          <h2 className="section-title">Temporada {game.season} terminada</h2>
          <p className="big">
            Terminaste {pos}º de {table.length} en la División {game.userDivision}.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={() => void nextSeason()}>
            Siguiente temporada
          </button>
        </section>
      ) : fx && odds ? (
        <section className="hero">
          <div className="hero-label">Próximo partido · Fecha {fx.matchday + 1}</div>
          <div className="hero-teams">
            <div className="hero-team">
              <Badge name={fx.home.name} color={fx.home.color} size="lg" />
              <span>{fx.home.name}</span>
              <small className="muted">Local</small>
            </div>
            <div className="hero-vs">vs</div>
            <div className="hero-team">
              <Badge name={fx.away.name} color={fx.away.color} size="lg" />
              <span>{fx.away.name}</span>
              <small className="muted">Visitante</small>
            </div>
          </div>
          <dl className="odds">
            <div>
              <dt>Gana local</dt>
              <dd>{pct(odds.home)}</dd>
            </div>
            <div>
              <dt>Empate</dt>
              <dd>{pct(odds.draw)}</dd>
            </div>
            <div>
              <dt>Gana visitante</dt>
              <dd>{pct(odds.away)}</dd>
            </div>
          </dl>
          <p className="muted center">
            Goles esperados: {odds.xg.home.toFixed(1)} - {odds.xg.away.toFixed(1)}
          </p>
          <div className="row2">
            <button type="button" className="btn" disabled={busy} onClick={startUserMatch}>
              Jugar en vivo
            </button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void quickPlayMatchday()}>
              Simular fecha
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="empty">No hay partido pendiente.</p>
        </section>
      )}

      <section className="card">
        <h2 className="section-title">Noticias</h2>
        {game.news.length === 0 ? (
          <p className="empty">Todavía no hay noticias.</p>
        ) : (
          <ul className="news">
            {game.news.slice(0, 8).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
