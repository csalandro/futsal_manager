import { useState } from 'react';
import type { Player } from '../domain/types';
import { userTeam } from '../engine/season';
import { useGame } from '../store/gameStore';
import { ratingClass } from './format';

type SortKey = 'number' | 'name' | 'pos' | 'age' | 'rating' | 'potential' | 'form' | 'fatigue' | 'contractYears' | 'gp' | 'goals' | 'assists';

const COLS: { key: SortKey; label: string; title: string; cls?: string }[] = [
  { key: 'number', label: '#', title: 'Número', cls: 'num hide-sm' },
  { key: 'name', label: 'Jugador', title: 'Nombre', cls: 'left sticky' },
  { key: 'pos', label: 'Pos', title: 'Posición' },
  { key: 'age', label: 'Edad', title: 'Edad', cls: 'num' },
  { key: 'rating', label: 'Act', title: 'Habilidad actual', cls: 'num' },
  { key: 'potential', label: 'Pot', title: 'Potencial', cls: 'num' },
  { key: 'form', label: 'Forma', title: 'Forma', cls: 'num' },
  { key: 'fatigue', label: 'Cond.', title: 'Condición física (100 − fatiga)' },
  { key: 'contractYears', label: 'Contr.', title: 'Años de contrato', cls: 'num hide-sm' },
  { key: 'gp', label: 'PJ', title: 'Partidos jugados', cls: 'num' },
  { key: 'goals', label: 'G', title: 'Goles', cls: 'num' },
  { key: 'assists', label: 'A', title: 'Asistencias', cls: 'num hide-sm' },
];

const POS_LABEL: Record<string, string> = { POR: 'Arquero', CIE: 'Cierre', ALA: 'Ala', PIV: 'Pívot' };

function sortValue(p: Player, key: SortKey): number | string {
  switch (key) {
    case 'gp':
      return p.stats.gamesPlayed;
    case 'goals':
      return p.stats.goals;
    case 'assists':
      return p.stats.assists;
    case 'pos':
      return ['POR', 'CIE', 'ALA', 'PIV'].indexOf(p.pos);
    default:
      return p[key];
  }
}

export function Squad() {
  const game = useGame((s) => s.game);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rating', dir: -1 });
  const team = game ? userTeam(game) : undefined;
  if (!team) return null;

  const starters = new Set(team.lineup.filter((id): id is string => !!id));
  const rows = [...team.squad].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    const c = typeof va === 'string' ? va.localeCompare(String(vb), 'es') : (va as number) - (vb as number);
    return c * sort.dir || a.number - b.number;
  });

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'pos' || key === 'number' ? 1 : -1 },
    );

  const avgAge = team.squad.reduce((s, p) => s + p.age, 0) / team.squad.length;
  const avgRating = team.squad.reduce((s, p) => s + p.rating, 0) / team.squad.length;

  return (
    <section className="panel flush">
      <header className="panel-head">
        <h2>Plantel</h2>
        <span className="panel-meta">
          {team.squad.length} jugadores · edad media {avgAge.toFixed(1)} · nivel medio {avgRating.toFixed(0)}
        </span>
      </header>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabla del plantel">
        <table className="grid squad">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={c.cls}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="th-btn" title={c.title} onClick={() => toggle(c.key)}>
                    {c.label}
                    <span className="sort-ind" aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const starter = starters.has(p.id);
              const cond = 100 - Math.max(0, Math.min(100, p.fatigue));
              return (
                <tr key={p.id} className={starter ? 'starter' : ''}>
                  <td className="num muted hide-sm">{p.number}</td>
                  <td className="left sticky">
                    <span className="player-cell">
                      <span className="pname">{p.name}</span>
                      {starter && (
                        <span className="tag tiny starter-tag" title="Titular">
                          <span className="hide-sm">Titular</span>
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className={`pos pos-${p.pos.toLowerCase()}`} title={POS_LABEL[p.pos]}>
                      {p.pos}
                    </span>
                  </td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>
                  </td>
                  <td className="num">
                    <span className={`rating ghost ${ratingClass(p.potential)}`}>{p.potential}</span>
                  </td>
                  <td className={`num ${p.form > 0 ? 'up' : p.form < 0 ? 'down' : 'muted'}`}>{p.form > 0 ? `+${p.form}` : p.form}</td>
                  <td>
                    <div className="meter slim" role="img" aria-label={`Condición ${cond}%`}>
                      <i style={{ width: `${cond}%` }} className={cond >= 67 ? 'good' : cond >= 34 ? 'mid' : 'bad'} />
                    </div>
                  </td>
                  <td className="num hide-sm">{p.contractYears}a</td>
                  <td className="num">{p.stats.gamesPlayed}</td>
                  <td className="num">{p.stats.goals}</td>
                  <td className="num hide-sm">{p.stats.assists}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
