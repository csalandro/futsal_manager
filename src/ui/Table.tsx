import { useState } from 'react';
import type { DivisionId } from '../domain/types';
import { standings } from '../engine/standings';
import { useGame } from '../store/gameStore';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

export function Table() {
  const game = useGame((s) => s.game);
  const [picked, setPicked] = useState<DivisionId | null>(null);
  if (!game || !game.userDivision) return null;

  const divId = picked ?? game.userDivision;
  const rows = standings(game.divisions[divId].teams);
  const n = rows.length;

  return (
    <section>
      <h2 className="section-title">Tabla de posiciones</h2>
      <div className="subtabs" role="group" aria-label="División">
        {DIVS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === divId}
            className={d === divId ? 'active' : ''}
            onClick={() => setPicked(d)}
          >
            División {d}
          </button>
        ))}
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`Tabla de la División ${divId}`}>
        <table className="league">
          <thead>
            <tr>
              <th>Pos</th>
              <th className="tname">Equipo</th>
              <th title="Partidos jugados">PJ</th>
              <th title="Ganados">G</th>
              <th title="Empatados">E</th>
              <th title="Perdidos">P</th>
              <th title="Goles a favor">GF</th>
              <th title="Goles en contra">GC</th>
              <th title="Diferencia de gol">DG</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const r = t.record;
              const promo = divId !== 'A' && i < 2;
              const releg = divId !== 'C' && i >= n - 2;
              const cls = [t.id === game.userTeamId ? 'me' : '', promo ? 'promo-zone' : '', releg ? 'relegation-zone' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <tr key={t.id} className={cls}>
                  <td>{i + 1}</td>
                  <td className="tname">{t.name}</td>
                  <td>{r.played}</td>
                  <td>{r.w}</td>
                  <td>{r.d}</td>
                  <td>{r.l}</td>
                  <td>{r.gf}</td>
                  <td>{r.ga}</td>
                  <td>{r.gf - r.ga}</td>
                  <td className="pts">{r.pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="zone-legend">
        {divId !== 'A' && (
          <span>
            <i className="zone-dot" style={{ background: 'var(--green)' }} /> Ascenso
          </span>
        )}
        {divId !== 'C' && (
          <span>
            <i className="zone-dot" style={{ background: 'var(--red)' }} /> Descenso
          </span>
        )}
      </div>
    </section>
  );
}
