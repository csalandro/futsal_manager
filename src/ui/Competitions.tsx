// Vistas de competiciones: goleadores, copa nacional, Copa Internacional, playoffs y Copa de Campeones.
// Pensadas para 375px: tablas con scroll horizontal y cruces en listas de una columna.
import type { DivisionId, GameState, Player, Team, Tie } from '../domain/types';
import { cupStageLabel, sortIntlGroup } from '../engine/competitions';
import { playoffStageLabel } from '../engine/calendar';
import { findTeam } from '../engine/season';
import { Badge } from './Badge';
import { TeamName, TieList } from './Ties';

const TOP = 20;

interface ScorerRow {
  player: Player;
  team: Team;
  goals: number;
}

function ScorerTable({ game, rows, empty }: { game: GameState; rows: ScorerRow[]; empty: string }) {
  if (rows.length === 0) {
    return (
      <section className="panel">
        <p className="empty">{empty}</p>
      </section>
    );
  }
  return (
    <section className="panel flush">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabla de goleadores">
        <table className="grid compact">
          <thead>
            <tr>
              <th className="num">#</th>
              <th className="left">Jugador</th>
              <th className="left">Equipo</th>
              <th className="num" title="Asistencias">
                Asist.
              </th>
              <th className="num">Goles</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.player.id} className={r.team.id === game.userTeamId ? 'me' : ''}>
                <td className="num">{i + 1}</td>
                <td className="left">
                  {r.player.name} <small className="muted">{r.player.pos}</small>
                </td>
                <td className="left">
                  <span className="team-cell">
                    <Badge name={r.team.name} color={r.team.color} size="sm" />
                    {r.team.name}
                  </span>
                </td>
                <td className="num">{r.player.stats.assists}</td>
                <td className="num strong">{r.goals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Top 20 de goleadores de liga de la división (HTML 3515-3538); los goles de copa y playoffs no cuentan. */
export function LeagueScorers({ game, divId }: { game: GameState; divId: DivisionId }) {
  const rows = game.divisions[divId].teams
    .flatMap((team) => team.squad.map((player) => ({ player, team, goals: player.stats.goals - (player.stats.cupGoals ?? 0) })))
    .filter((r) => r.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.player.stats.assists - a.player.stats.assists || a.player.name.localeCompare(b.player.name, 'es'))
    .slice(0, TOP);
  return <ScorerTable game={game} rows={rows} empty="Todavía no hay goles de liga registrados esta temporada." />;
}

/** Top 20 de goleadores de copas (nacional, Internacional, playoffs y Copa de Campeones). */
export function CupScorers({ game }: { game: GameState }) {
  const teams = [...(['A', 'B', 'C'] as const).flatMap((d) => game.divisions[d].teams), ...Object.values(game.intlGuestTeams)];
  const rows = teams
    .flatMap((team) => team.squad.map((player) => ({ player, team, goals: player.stats.cupGoals ?? 0 })))
    .filter((r) => r.goals > 0)
    .sort((a, b) => b.goals - a.goals || a.player.name.localeCompare(b.player.name, 'es'))
    .slice(0, TOP);
  return <ScorerTable game={game} rows={rows} empty="Todavía no hay goles de copa registrados esta temporada." />;
}

function Round({ game, title, ties, open }: { game: GameState; title: string; ties: Tie[]; open: boolean }) {
  return (
    <details className="panel" open={open}>
      <summary>
        <b>{title}</b> <span className="tag tiny">{ties.length} partido{ties.length === 1 ? '' : 's'}</span>
      </summary>
      <TieList game={game} ties={ties} />
    </details>
  );
}

export function CupView({ game }: { game: GameState }) {
  const cup = game.cup;
  if (!cup) {
    return (
      <section className="panel">
        <p className="empty">Esta temporada no se juega la Copa (la partida arrancó con las rondas ya pasadas).</p>
      </section>
    );
  }
  return (
    <div className="bracket">
      <section className="panel">
        <header className="panel-head">
          <h2>Copa</h2>
          <span className="tag accent">{cup.champion ? 'Terminada' : cupStageLabel(cup.stage)}</span>
        </header>
        {cup.champion ? (
          <p>
            🏆 Campeón: <TeamName game={game} id={cup.champion} />
          </p>
        ) : (
          <p className="muted small">Partido único con penales. Participan los 54 clubes; los 10 mejores de A entran desde la segunda ronda.</p>
        )}
        {cup.pendingByes && (
          <p className="small">
            <b>Con bye:</b> {cup.pendingByes.map((id) => findTeam(game, id)?.name ?? id).join(', ')}
          </p>
        )}
      </section>
      {!cup.champion && <Round game={game} title={cupStageLabel(cup.stage)} ties={cup.ties} open />}
      {[...cup.rounds].reverse().map((r) => (
        <Round key={r.stage} game={game} title={cupStageLabel(r.stage)} ties={r.ties} open={cup.champion !== null && r.stage === cup.rounds.length - 1} />
      ))}
    </div>
  );
}

export function IntlView({ game }: { game: GameState }) {
  const ic = game.intlCup;
  if (!ic) {
    return (
      <section className="panel">
        <p className="empty">Esta temporada no hay Copa Internacional: clasifica el campeón de los playoffs de Primera A.</p>
      </section>
    );
  }
  const groups = (['A', 'B', 'C'] as const).filter((g) => ic.groups[g]);
  return (
    <div className="bracket">
      <section className="panel">
        <header className="panel-head">
          <h2>Copa Internacional</h2>
          <span className="tag accent">{ic.stage === 'done' ? 'Terminada' : ic.stage === 'groups' ? `Grupos · fecha ${Math.min(ic.groupRound + 1, 3)}` : ic.stage}</span>
        </header>
        {ic.champion ? (
          <p>
            🌎🏆 Campeón: <TeamName game={game} id={ic.champion} />
          </p>
        ) : (
          <p className="muted small">12 equipos en 3 grupos de 4. Pasan los 2 primeros de cada grupo y los 2 mejores terceros.</p>
        )}
      </section>
      {groups.map((g) => (
        <section key={g} className="panel flush">
          <header className="panel-head">
            <h2>Grupo {g}</h2>
          </header>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`Grupo ${g}`}>
            <table className="grid compact">
              <thead>
                <tr>
                  <th className="left">Equipo</th>
                  <th className="num">PJ</th>
                  <th className="num">G</th>
                  <th className="num">E</th>
                  <th className="num">P</th>
                  <th className="num">DG</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {sortIntlGroup(ic.groups[g]).map((row, i) => (
                  <tr key={row.id} className={`${row.id === game.userTeamId ? 'me' : ''}${i < 2 ? ' zone-up' : ''}`}>
                    <td className="left">
                      <TeamName game={game} id={row.id} />
                    </td>
                    <td className="num">{row.w + row.d + row.l}</td>
                    <td className="num">{row.w}</td>
                    <td className="num">{row.d}</td>
                    <td className="num">{row.l}</td>
                    <td className="num">{row.gf - row.ga}</td>
                    <td className="num strong">{row.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-body-pad">
            {ic.groupSchedule[g].map((round, ri) => (
              <div key={ri}>
                <p className="muted small">Fecha {ri + 1}</p>
                <TieList game={game} ties={round} />
              </div>
            ))}
          </div>
        </section>
      ))}
      {ic.stage !== 'groups' && ic.stage !== 'done' && (
        <Round game={game} title={ic.stage === 'QF' ? 'Cuartos de final' : ic.stage === 'SF' ? 'Semifinal' : 'Final'} ties={ic.ties} open />
      )}
      {[...ic.rounds].reverse().map((r) => (
        <Round key={r.stage} game={game} title={r.stage === 'QF' ? 'Cuartos de final' : r.stage === 'SF' ? 'Semifinal' : 'Final'} ties={r.ties} open={false} />
      ))}
    </div>
  );
}

export function PlayoffView({ game, divId }: { game: GameState; divId: DivisionId }) {
  const div = game.divisions[divId];
  const p = div.playoff;
  const goal = divId === 'A' ? 'por el título' : `por el ascenso a Primera ${divId === 'B' ? 'A' : 'B'}`;
  if (!p) {
    return (
      <section className="panel">
        <p className="empty">
          Los playoffs de Primera {divId} se juegan al terminar la liga ({divId === 'A' ? 'los 8 primeros' : 'del 2º al 9º; el campeón asciende directo'}).
        </p>
      </section>
    );
  }
  const table = (ids: string[]) => ids.map((id, i) => `${i + 1}. ${findTeam(game, id)?.name ?? id}`).join(' · ');
  return (
    <div className="bracket">
      <section className="panel">
        <header className="panel-head">
          <h2>Playoffs · Primera {divId}</h2>
          <span className="tag accent">{p.stage === 'done' ? 'Terminados' : playoffStageLabel(p.stage)}</span>
        </header>
        {div.promotedDirect && (
          <p className="small">
            ⬆️ Ascenso directo: <b>{findTeam(game, div.promotedDirect)?.name}</b>
          </p>
        )}
        <p className="muted small">Cuartos, semifinal y final a partido único con penales, {goal}.</p>
        {p.winner && (
          <p>
            {divId === 'A' ? '🏆 Campeón' : '⬆️ Segundo ascenso'}: <TeamName game={game} id={p.winner} />
          </p>
        )}
        <p className="muted small">Clasificados: {table(p.quals)}</p>
        {div.relegated && divId !== 'C' && (
          <p className="small">⬇️ Descienden: {div.relegated.map((id) => findTeam(game, id)?.name ?? id).join(', ')}</p>
        )}
        {div.relegated && divId === 'C' && (
          <p className="small">⬇️ Salen de la liga: {div.relegated.map((id) => findTeam(game, id)?.name ?? id).join(', ')}</p>
        )}
      </section>
      {p.stage !== 'done' && <Round game={game} title={playoffStageLabel(p.stage)} ties={p.ties} open />}
      {[...p.rounds].reverse().map((r) => (
        <Round key={r.stage} game={game} title={playoffStageLabel(r.stage)} ties={r.ties} open={false} />
      ))}
    </div>
  );
}

export function ChampionsView({ game }: { game: GameState }) {
  const cc = game.championsCup;
  const mine = game.titles.length;
  return (
    <div className="bracket">
      <section className="panel">
        <header className="panel-head">
          <h2>Copa de Campeones</h2>
          <span className="tag accent">{cc ? (cc.stage === 'done' ? 'Terminada' : cc.stage === 'SF' ? 'Semifinales' : 'Final') : 'Pendiente'}</span>
        </header>
        <p className="muted small">
          Se juega al cerrar la temporada: campeón de A (playoffs) vs campeón de C, y campeón de B vs campeón de la Copa (si ya está clasificado, lo
          representa el subcampeón de A).
        </p>
        {cc?.champion && (
          <p>
            🏆🏆 Campeón: <TeamName game={game} id={cc.champion} />
          </p>
        )}
        <p className="small">Títulos del usuario: <b>{mine}</b></p>
      </section>
      {cc && cc.stage !== 'done' && <Round game={game} title={cc.stage === 'SF' ? 'Semifinales' : 'Final'} ties={cc.ties} open />}
      {cc && [...cc.rounds].reverse().map((r) => <Round key={r.stage} game={game} title={r.stage === 'SF' ? 'Semifinales' : 'Final'} ties={r.ties} open={false} />)}
      <section className="panel">
        <header className="panel-head">
          <h2>Historial de campeones</h2>
        </header>
        {game.championsHistory.length === 0 ? (
          <p className="empty">Todavía no hay temporadas cerradas.</p>
        ) : (
          [...game.championsHistory].reverse().map((h) => (
            <dl key={h.season} className="champ-row">
              <dt>Temp. {h.season}</dt>
              <dd>
                <b>Campeones</b>: {h.champChampionsCup?.name ?? '—'}
                <br />
                A: {h.champA?.name ?? '—'} · B: {h.champB?.name ?? '—'} · C: {h.champC?.name ?? '—'}
                <br />
                Copa: {h.champCup?.name ?? '—'}
                {h.champCupRep ? ` (representó: ${h.champCupRep.name})` : ''}
                {h.champIntl ? ` · Internacional: ${h.champIntl.name}` : ''}
              </dd>
            </dl>
          ))
        )}
      </section>
    </div>
  );
}
