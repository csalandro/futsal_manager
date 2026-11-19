import { useState } from 'react';
import type { DivisionId } from '../domain/types';
import { COMPETITIONS } from '../engine/config';
import { standings } from '../engine/standings';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';
import { ChampionsView, CupScorers, CupView, IntlView, LeagueScorers, PlayoffView } from './Competitions';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

type Sub = 'standings' | 'scorers' | 'cup' | 'cupScorers' | 'intl' | 'playoffs' | 'champions';

export function Table() {
  const game = useGame((s) => s.game);
  const [picked, setPicked] = useState<DivisionId | null>(null);
  const [sub, setSub] = useState<Sub>('standings');
  if (!game || !game.userDivision) return null;

  const divId = picked ?? game.userDivision;
  const subs: [Sub, string][] = [
    ['standings', 'Posiciones'],
    ['scorers', 'Goleadores'],
    ['playoffs', 'Playoffs'],
    ['cup', 'Copa'],
    ['cupScorers', 'Goleadores copa'],
    ...(game.intlCup ? ([['intl', 'Internacional']] as [Sub, string][]) : []),
    ['champions', 'Campeones'],
  ];
  const perDivision = sub === 'standings' || sub === 'scorers' || sub === 'playoffs';

  const divToggle = (
    <div className="segmented small" role="group" aria-label="División">
      {DIVS.map((d) => (
        <button key={d} type="button" aria-pressed={d === divId} className={d === divId ? 'on' : ''} onClick={() => setPicked(d)}>
          {d}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="sub-tabs" role="tablist" aria-label="Competiciones">
        {subs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>
      {perDivision && <div className="sub-div">{divToggle}</div>}
      {sub === 'standings' && <Standings divId={divId} />}
      {sub === 'scorers' && <LeagueScorers game={game} divId={divId} />}
      {sub === 'playoffs' && <PlayoffView game={game} divId={divId} />}
      {sub === 'cup' && <CupView game={game} />}
      {sub === 'cupScorers' && <CupScorers game={game} />}
      {sub === 'intl' && <IntlView game={game} />}
      {sub === 'champions' && <ChampionsView game={game} />}
    </>
  );
}

function Standings({ divId }: { divId: DivisionId }) {
  const game = useGame((s) => s.game);
  if (!game) return null;
  const rows = standings(game.divisions[divId].teams);
  const n = rows.length;

  return (
    <section className="panel flush">
      <header className="panel-head">
        <h2>Liga · División {divId}</h2>
      </header>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`Tabla de la División ${divId}`}>
        <table className="grid league">
          <thead>
            <tr>
              <th className="num">Pos</th>
              <th className="left sticky">Equipo</th>
              <th className="num" title="Partidos jugados">PJ</th>
              <th className="num" title="Ganados">G</th>
              <th className="num" title="Empatados">E</th>
              <th className="num" title="Perdidos">P</th>
              <th className="num hide-sm" title="Goles a favor">GF</th>
              <th className="num hide-sm" title="Goles en contra">GC</th>
              <th className="num" title="Diferencia de gol">DG</th>
              <th className="num">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const r = t.record;
              // Cupos del original (HTML 1699-1728): B y C: 1º asciende directo y del 2º al 9º juegan el playoff; A: los 8 primeros
              // juegan por el título; descienden 2 de A, 2 de B y 3 de C.
              const direct = divId !== 'A' && i === 0;
              const playoff = !direct && i < (divId === 'A' ? 8 : 9);
              const releg = i >= n - COMPETITIONS.relegations[divId];
              const cls = [t.id === game.userTeamId ? 'me' : '', direct ? 'zone-up' : '', playoff ? 'zone-po' : '', releg ? 'zone-down' : ''].filter(Boolean).join(' ');
              const dg = r.gf - r.ga;
              return (
                <tr key={t.id} className={cls}>
                  <td className="num pos-cell">{i + 1}</td>
                  <td className="left sticky">
                    <span className="team-cell">
                      <Badge name={t.name} color={t.color} size="sm" />
                      {t.name}
                    </span>
                  </td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.w}</td>
                  <td className="num">{r.d}</td>
                  <td className="num">{r.l}</td>
                  <td className="num hide-sm">{r.gf}</td>
                  <td className="num hide-sm">{r.ga}</td>
                  <td className={`num ${dg > 0 ? 'up' : dg < 0 ? 'down' : ''}`}>{dg > 0 ? `+${dg}` : dg}</td>
                  <td className="num strong">{r.pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="legend">
        {divId !== 'A' && (
          <span>
            <i className="zone-dot up" /> Ascenso directo
          </span>
        )}
        <span>
          <i className="zone-dot po" /> {divId === 'A' ? 'Playoffs por el título' : 'Playoff de ascenso'}
        </span>
        <span>
          <i className="zone-dot down" /> {divId === 'C' ? 'Salen de la liga' : 'Descenso'}
        </span>
      </footer>
    </section>
  );
}
