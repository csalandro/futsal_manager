import { useState } from 'react';
import type { Player } from '../domain/types';
import { userTeam } from '../engine/season';
import { useGame } from '../store/gameStore';

type SortKey = 'number' | 'name' | 'pos' | 'age' | 'rating' | 'potential' | 'form' | 'fatigue' | 'contractYears' | 'gp' | 'goals' | 'assists';

const SPRITE: Record<string, string> = { POR: 'gk', CIE: 'cie', ALA: 'ala', PIV: 'piv' };

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: 'number', label: '#', title: 'Número' },
  { key: 'name', label: 'Nombre', title: 'Nombre' },
  { key: 'pos', label: 'Pos', title: 'Posición' },
  { key: 'age', label: 'Edad', title: 'Edad' },
  { key: 'rating', label: 'Rat', title: 'Rating' },
  { key: 'potential', label: 'Pot', title: 'Potencial' },
  { key: 'form', label: 'Forma', title: 'Forma' },
  { key: 'fatigue', label: 'Fatiga', title: 'Fatiga' },
  { key: 'contractYears', label: 'Contr.', title: 'Años de contrato' },
  { key: 'gp', label: 'PJ', title: 'Partidos jugados' },
  { key: 'goals', label: 'G', title: 'Goles' },
  { key: 'assists', label: 'A', title: 'Asistencias' },
];

function sortValue(p: Player, key: SortKey): number | string {
  switch (key) {
    case 'gp':
      return p.stats.gamesPlayed;
    case 'goals':
      return p.stats.goals;
    case 'assists':
      return p.stats.assists;
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
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'pos' || key === 'number' ? 1 : -1 }));

  return (
    <section>
      <h2 className="section-title">Plantel ({team.squad.length})</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabla del plantel">
        <table className="league squad">
          <thead>
            <tr>
              <th aria-label="Titular" />
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={c.key === 'name' ? 'tname' : ''}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="th-btn" title={c.title} onClick={() => toggle(c.key)}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const starter = starters.has(p.id);
              return (
                <tr key={p.id} className={starter ? 'me' : ''}>
                  <td>{starter ? <span className="starter-toggle on" title="Titular" aria-label="Titular">✓</span> : null}</td>
                  <td className="mono">{p.number}</td>
                  <td className="tname">
                    <img className="sprite" src={`/pixel/${SPRITE[p.pos] ?? 'cie'}.png`} alt="" aria-hidden="true" />
                    {p.name}
                  </td>
                  <td>
                    <span className={`pos-chip pos-${p.pos.toLowerCase()}`}>{p.pos}</span>
                  </td>
                  <td>{p.age}</td>
                  <td className="mono">{p.rating}</td>
                  <td className="mono">{p.potential}</td>
                  <td className={`mono ${p.form > 0 ? 'up' : p.form < 0 ? 'down' : ''}`}>{p.form > 0 ? `+${p.form}` : p.form}</td>
                  <td>
                    <div className="bar" role="img" aria-label={`Fatiga ${p.fatigue}%`}>
                      <div
                        className={`bar-fill ${p.fatigue >= 66 ? 'high' : p.fatigue >= 33 ? 'mid' : ''}`}
                        style={{ width: `${Math.max(0, Math.min(100, p.fatigue))}%` }}
                      />
                    </div>
                  </td>
                  <td>{p.contractYears}</td>
                  <td>{p.stats.gamesPlayed}</td>
                  <td>{p.stats.goals}</td>
                  <td>{p.stats.assists}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
