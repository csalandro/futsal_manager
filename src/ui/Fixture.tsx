import { useGame } from '../store/gameStore';

export function Fixture() {
  const game = useGame((s) => s.game);
  if (!game || !game.userDivision) return null;
  const div = game.divisions[game.userDivision];
  const names = new Map(div.teams.map((t) => [t.id, t.name]));
  const me = game.userTeamId;

  return (
    <section>
      <h2 className="section-title">Fixture · División {div.id}</h2>
      {div.schedule.map((round, i) => {
        const played = i < div.matchday ? div.results[i] : undefined;
        return (
          <div key={i} className="card round">
            <h3 className="round-title">
              Fecha {i + 1}
              {i === div.matchday ? ' · próxima' : ''}
            </h3>
            <ul className="matches">
              {round.map(([h, a]) => {
                const r = played?.find((x) => x.homeId === h && x.awayId === a);
                const mine = h === me || a === me;
                return (
                  <li key={h + a} className={`match${mine ? ' me' : ''}`}>
                    <span className="m-home">{names.get(h) ?? h}</span>
                    <span className="m-score">{r ? `${r.hg} - ${r.ag}` : 'vs'}</span>
                    <span className="m-away">{names.get(a) ?? a}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
