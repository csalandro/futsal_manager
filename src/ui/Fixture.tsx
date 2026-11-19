import { useEffect, useRef } from 'react';
import { stepTieGroups } from '../engine/competitions';
import { stepLabel } from '../engine/calendar';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';
import { TieList } from './Ties';

/** Calendario completo e intercalado: fechas de liga, rondas de copa, Internacional, playoffs y Copa de Campeones. */
export function Fixture() {
  const game = useGame((s) => s.game);
  const nextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    nextRef.current?.scrollIntoView({ block: 'start' });
  }, []);
  if (!game || !game.userDivision) return null;
  const div = game.divisions[game.userDivision];
  const teams = new Map(div.teams.map((t) => [t.id, t]));
  const me = game.userTeamId;

  return (
    <div className="rounds">
      {game.calendar.map((step, i) => {
        const isNext = i === game.calendarIndex;
        const done = i < game.calendarIndex;
        const status = isNext ? <span className="tag accent">Próxima</span> : done ? <span className="tag">Jugada</span> : null;

        if (step.kind === 'league') {
          const round = div.schedule[step.round] ?? [];
          const played = step.round < div.matchday ? div.results[step.round] : undefined;
          return (
            <section key={i} className={`panel round${isNext ? ' next' : ''}`} ref={isNext ? nextRef : undefined}>
              <header className="panel-head">
                <h2>Fecha {step.round + 1}</h2>
                {status}
              </header>
              <ul className="matches">
                {round.map(([h, a]) => {
                  const r = played?.find((x) => x.homeId === h && x.awayId === a);
                  const home = teams.get(h);
                  const away = teams.get(a);
                  const mine = h === me || a === me;
                  return (
                    <li key={h + a} className={mine ? 'me' : ''}>
                      <span className="m-team home">
                        <span className="ellipsis">{home?.name ?? h}</span>
                        {home && <Badge name={home.name} color={home.color} size="sm" />}
                      </span>
                      <span className={`m-score${r ? '' : ' pending'}`}>{r ? `${r.hg} – ${r.ag}` : 'vs'}</span>
                      <span className="m-team away">
                        {away && <Badge name={away.name} color={away.color} size="sm" />}
                        <span className="ellipsis">{away?.name ?? a}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        }

        // Pasos que no son de liga: se muestra el partido del usuario (si lo hay); el cuadro completo está en Competición.
        const groups = stepTieGroups(game, step);
        const mine = groups.flatMap((g) => g.ties).some((t) => t.home === me || t.away === me);
        return (
          <section key={i} className={`panel round${isNext ? ' next' : ''}${done ? ' done' : ''}`} ref={isNext ? nextRef : undefined}>
            <header className="panel-head">
              <h2>{stepLabel(step)}</h2>
              {status}
            </header>
            {mine ? (
              groups.map((g) => <TieList key={g.title} game={game} ties={g.ties} onlyMine />)
            ) : (
              <p className="muted small">
                {groups.length === 0
                  ? done
                    ? 'No se disputó en esta temporada.'
                    : 'Se define según cómo avance la competencia.'
                  : 'No jugás en este paso: se simula solo.'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
