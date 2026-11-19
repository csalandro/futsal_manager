import { useState } from 'react';
import type { Player } from '../domain/types';
import { FATIGUE_BLOCK, SQUAD } from '../engine/config';
import { canSpend, LOCKOUT_REASON } from '../engine/finance';
import { userTeam } from '../engine/season';
import { fireBlocker, renewCost, severanceCost } from '../engine/squad';
import { useGame } from '../store/gameStore';
import { FinanceAlert } from './Club';
import { money, ratingClass } from './format';

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
  const renew = useGame((s) => s.renewContract);
  const fire = useGame((s) => s.firePlayer);
  const setNumber = useGame((s) => s.setPlayerNumber);
  const [confirmFire, setConfirmFire] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
          <b title="Presupuesto del club">Presupuesto {money(team.budget)}</b> · {team.squad.length}/{SQUAD.max} jugadores · edad media{' '}
          {avgAge.toFixed(1)} · nivel medio {avgRating.toFixed(0)}
        </span>
      </header>
      <FinanceAlert team={team} />
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
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
              <th title="Lesiones, sanciones y fatiga">Estado</th>
              <th className="left">Contrato</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const starter = starters.has(p.id);
              const cond = 100 - Math.max(0, Math.min(100, p.fatigue));
              return (
                <tr key={p.id} className={starter ? 'starter' : ''}>
                  <td className="num hide-sm">
                    <input
                      type="number"
                      className="num-input"
                      min={1}
                      max={99}
                      aria-label={`Número de ${p.name}`}
                      key={`${p.id}-${p.number}`}
                      defaultValue={p.number}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (n === p.number) return;
                        const err = setNumber(p.id, n);
                        setNotice(err);
                        if (err) e.target.value = String(p.number);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </td>
                  <td className="left sticky">
                    <span className="player-cell">
                      <span className="pname">{p.name}</span>
                      {p.transferListed && (
                        <span className="tag tiny" title="Transferible: puede recibir ofertas" role="img" aria-label="Transferible">
                          📢
                        </span>
                      )}
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
                  <td>
                    <span className="status-icons">
                      {p.injury && (
                        <span
                          role="img"
                          title={`Lesionado: ${p.injury.type}, ${p.injury.matchesLeft} fecha(s)`}
                          aria-label={`Lesionado ${p.injury.matchesLeft} fechas`}
                        >
                          🚑 {p.injury.matchesLeft}
                        </span>
                      )}
                      {p.suspension > 0 && (
                        <span role="img" title={`Suspendido ${p.suspension} partido(s)`} aria-label={`Suspendido ${p.suspension} partidos`}>
                          🟥 {p.suspension}
                        </span>
                      )}
                      {p.fatigue >= FATIGUE_BLOCK && (
                        <span role="img" title="Fatiga bloqueada: no puede ser titular" aria-label="Fatiga bloqueada">
                          😮‍💨
                        </span>
                      )}
                      {!p.injury && p.suspension === 0 && p.fatigue < FATIGUE_BLOCK && (
                        <span className="muted" aria-label="Disponible" title="Disponible">
                          —
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="left">
                    <span className="row-actions">
                      <button
                        type="button"
                        className="btn small"
                        disabled={p.contractYears >= SQUAD.maxContractYears || team.budget < renewCost(p) || !canSpend(team)}
                        title={canSpend(team) ? `Renovar por 2-3 años (máx ${SQUAD.maxContractYears})` : LOCKOUT_REASON}
                        onClick={() => setNotice(renew(p.id))}
                      >
                        Renovar {money(renewCost(p))}
                      </button>
                      {confirmFire === p.id ? (
                        <>
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() => {
                              setNotice(fire(p.id));
                              setConfirmFire(null);
                            }}
                          >
                            Confirmar {money(severanceCost(p))}
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => setConfirmFire(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn small ghost danger-text"
                          disabled={fireBlocker(team, p) !== null}
                          title={fireBlocker(team, p) ?? `Despedir: indemnización ${money(severanceCost(p))}`}
                          onClick={() => setConfirmFire(p.id)}
                        >
                          Despedir
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
