import { useState } from 'react';
import type { DivisionId } from '../domain/types';
import { standings } from '../engine/standings';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

export function Table() {
  const game = useGame((s) => s.game);
  const [picked, setPicked] = useState<DivisionId | null>(null);
  if (!game || !game.userDivision) return null;

  const divId = picked ?? game.userDivision;
  const rows = standings(game.divisions[divId].teams);
  const n = rows.length;

  return (
    <section className="panel flush">
      <header className="panel-head">
        <h2>Liga · División {divId}</h2>
        <div className="segmented small" role="group" aria-label="División">
          {DIVS.map((d) => (
            <button key={d} type="button" aria-pressed={d === divId} className={d === divId ? 'on' : ''} onClick={() => setPicked(d)}>
              {d}
            </button>
          ))}
        </div>
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
              const promo = divId !== 'A' && i < 2;
              const releg = divId !== 'C' && i >= n - 2;
              const champ = divId === 'A' && i === 0;
              const cls = [t.id === game.userTeamId ? 'me' : '', promo || champ ? 'zone-up' : '', releg ? 'zone-down' : ''].filter(Boolean).join(' ');
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
        {divId === 'A' && (
          <span>
            <i className="zone-dot up" /> Campeón
          </span>
        )}
        {divId !== 'A' && (
          <span>
            <i className="zone-dot up" /> Ascenso
          </span>
        )}
        {divId !== 'C' && (
          <span>
            <i className="zone-dot down" /> Descenso
          </span>
        )}
      </footer>
    </section>
  );
}
