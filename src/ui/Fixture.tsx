import { useEffect, useRef } from 'react';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';

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
      {div.schedule.map((round, i) => {
        const played = i < div.matchday ? div.results[i] : undefined;
        const isNext = i === div.matchday;
        return (
          <section key={i} className={`panel round${isNext ? ' next' : ''}`} ref={isNext ? nextRef : undefined}>
            <header className="panel-head">
              <h2>Fecha {i + 1}</h2>
              {isNext ? <span className="tag accent">Próxima</span> : played ? <span className="tag">Jugada</span> : null}
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
      })}
    </div>
  );
}
