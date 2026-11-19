import { useState } from 'react';
import type { CompetitionKey, GameState, TeamRef } from '../domain/types';
import { boardPressure, DT_AGE_RANGE, DT_NAME_MAX, dtReputation, titlesOf } from '../engine/dt';
import { findTeam, userTeam } from '../engine/season';
import { teamDivision } from '../engine/world';
import { teamStrength } from '../engine/strength';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';
import { money } from './format';

type Sub = 'perfil' | 'ofertas' | 'historial' | 'palmares' | 'campeones';

const COMPETITION_LABEL: Record<CompetitionKey, string> = {
  divA: 'Primera A',
  divB: 'Primera B',
  divC: 'Primera C',
  copa: 'Copa',
  intl: 'Copa Internacional',
  campeones: 'Copa de Campeones',
};

/** Aviso de la directiva por la racha de objetivos fallados y por cómo viene la temporada. Se usa en Inicio y en el perfil. */
export function BoardAlert({ game }: { game: GameState }) {
  const openClub = useGame((s) => s.openClub);
  const p = boardPressure(game);
  if (!p.text && p.outlook !== 'risk') return null;
  const cls = p.level === 'ultimatum' || p.level === 'critical' ? 'error' : 'warn';
  return (
    <p className={`alert ${cls}`} role={cls === 'error' ? 'alert' : 'status'}>
      {p.text ?? '📉 La directiva está preocupada.'}
      {p.outlook === 'risk' && ' Además, esta temporada el objetivo se te está escapando.'}{' '}
      <button type="button" className="link" onClick={() => openClub('dt')}>
        Ver DT
      </button>
    </p>
  );
}

/** Ofertas de trabajo: aceptar cambia de club (con confirmación si todavía tenés uno). */
export function JobOffers({ game, onResult }: { game: GameState; onResult?: (m: string | null) => void }) {
  const accept = useGame((s) => s.acceptJobOffer);
  const reject = useGame((s) => s.rejectJobOffer);
  const [confirm, setConfirm] = useState<string | null>(null);
  const me = userTeam(game);
  const offers = game.dt.jobOffers.filter((o) => findTeam(game, o.teamId));
  if (offers.length === 0) return <p className="empty">No hay ofertas por ahora.</p>;
  return (
    <div className="stack">
      {offers.map((o) => {
        const club = findTeam(game, o.teamId)!;
        const div = teamDivision(game, club.id);
        return (
          <div key={o.teamId} className="offer-row">
            <div>
              <strong className="team-cell">
                <Badge name={club.name} color={club.color} size="sm" /> {club.name}
              </strong>
              <span className="muted small">
                División {div} · fuerza {Math.round(teamStrength(club))} · presupuesto {money(club.budget)} · {club.squad.length} jugadores
              </span>
              {confirm === o.teamId && me && (
                <span className="small down">Si aceptás, dejás {me.name} ahora mismo y arrancás con el plantel y el presupuesto de {club.name}.</span>
              )}
            </div>
            <span className="row-actions">
              {confirm === o.teamId ? (
                <>
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => {
                      const err = accept(o.teamId);
                      setConfirm(null);
                      onResult?.(err);
                    }}
                  >
                    Confirmar
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => {
                      if (me) setConfirm(o.teamId);
                      else onResult?.(accept(o.teamId));
                    }}
                  >
                    Aceptar
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => reject(o.teamId)}>
                    Rechazar
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Perfil({ game }: { game: GameState }) {
  const setName = useGame((s) => s.setDtName);
  const setAge = useGame((s) => s.setDtAge);
  const c = game.dt.career;
  const winPct = c.matches > 0 ? Math.round((c.wins / c.matches) * 100) : 0;
  const titles = game.titles.length;
  return (
    <div className="stack">
      <BoardAlert game={game} />
      <section className="panel">
        <header className="panel-head">
          <h2>Perfil</h2>
        </header>
        <label className="field">
          <span>Director técnico</span>
          <input
            type="text"
            maxLength={DT_NAME_MAX}
            key={game.dtName}
            defaultValue={game.dtName}
            onBlur={(e) => {
              if (e.target.value.trim() !== game.dtName) setName(e.target.value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <label className="field">
          <span>
            Edad ({DT_AGE_RANGE[0]} a {DT_AGE_RANGE[1]}; suma un año por temporada)
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={DT_AGE_RANGE[0]}
            max={DT_AGE_RANGE[1]}
            key={game.dt.age}
            defaultValue={game.dt.age}
            onBlur={(e) => {
              if (Number(e.target.value) !== game.dt.age) setAge(Number(e.target.value));
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <dl className="kv">
          <div>
            <dt>Procedencia</dt>
            <dd>{game.dt.origin}</dd>
          </div>
          <div>
            <dt>Reputación</dt>
            <dd>{Math.round(dtReputation(game))}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Carrera</h2>
          <span className="panel-meta">Todas las competiciones</span>
        </header>
        <dl className="kv">
          <div>
            <dt>Temporadas dirigiendo</dt>
            <dd>{c.seasons}</dd>
          </div>
          <div>
            <dt>Partidos</dt>
            <dd>{c.matches}</dd>
          </div>
          <div>
            <dt>Ganados / empatados / perdidos</dt>
            <dd>
              {c.wins} / {c.draws} / {c.losses}
            </dd>
          </div>
          <div>
            <dt>% de victorias</dt>
            <dd>{winPct}%</dd>
          </div>
          <div>
            <dt>Títulos</dt>
            <dd>🏆 {titles}</dd>
          </div>
        </dl>
      </section>

      <section className="panel flush">
        <header className="panel-head">
          <h2>Clubes dirigidos</h2>
          <span className="tag">{game.dt.tenures.length}</span>
        </header>
        {game.dt.tenures.length === 0 ? (
          <p className="empty">Todavía no dirigiste a ningún club.</p>
        ) : (
          <div className="table-scroll">
            <table className="grid compact">
              <thead>
                <tr>
                  <th className="left">Club</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                  <th className="num">PJ</th>
                  <th className="num">G</th>
                  <th className="num">E</th>
                  <th className="num">P</th>
                  <th className="num">🏆</th>
                </tr>
              </thead>
              <tbody>
                {[...game.dt.tenures].reverse().map((t, i) => (
                  <tr key={`${t.teamId}-${t.fromSeason}-${i}`} className={t.toSeason === null ? 'me' : ''}>
                    <td className="left">{t.teamName}</td>
                    <td>T{t.fromSeason}</td>
                    <td>{t.toSeason === null ? 'hoy' : `T${t.toSeason}`}</td>
                    <td className="num">{t.matches}</td>
                    <td className="num">{t.wins}</td>
                    <td className="num">{t.draws}</td>
                    <td className="num">{t.losses}</td>
                    <td className="num">{titlesOf(game, t.teamId).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Ofertas({ game }: { game: GameState }) {
  const [notice, setNotice] = useState<string | null>(null);
  const me = userTeam(game);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Ofertas de otros clubes</h2>
        <span className="tag">{game.dt.jobOffers.length}</span>
      </header>
      <p className="muted small hint">
        Otros clubes te quieren de DT. Les llegan más ofertas a los que ganan títulos y partidos
        {me ? `; si aceptás, dejás ${me.name} ahora mismo.` : '.'}
      </p>
      {notice && (
        <p className="alert error" role="alert">
          {notice}
        </p>
      )}
      <JobOffers game={game} onResult={setNotice} />
    </section>
  );
}

function Historial({ game }: { game: GameState }) {
  const me = userTeam(game);
  const from = game.dt.tenures[game.dt.tenures.length - 1]?.fromSeason ?? 0;
  const rows = game.seasonHistory.filter((r) => (r.teamId ? r.teamId === me?.id : true) && r.season >= from).reverse();
  return (
    <section className="panel flush">
      <header className="panel-head">
        <h2>Historial de {me?.name ?? 'el club'}</h2>
        <span className="tag">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="empty">Todavía no completaste ninguna temporada en este club.</p>
      ) : (
        <ul className="ledger">
          {rows.map((r) => (
            <li key={`${r.season}-${r.teamId ?? ''}`}>
              <span className="ledger-text">
                <span>
                  Temporada {r.season} · Primera {r.division} · {r.position}° {r.objectiveMet === true ? '✅' : r.objectiveMet === false ? '❌' : ''}
                </span>
                <small className="muted">{r.objective ? `Objetivo: ${r.objective.text}` : 'Sin objetivo'}</small>
              </span>
              <b>{r.outcome}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Palmares({ game }: { game: GameState }) {
  const total = game.titles.length;
  const byComp = (Object.keys(COMPETITION_LABEL) as CompetitionKey[])
    .map((k) => ({ k, n: game.titles.filter((t) => t.competition === k) }))
    .filter((x) => x.n.length > 0);
  const first = game.dt.tenures[0];
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Palmarés</h2>
        <span className="panel-meta">🏆 {total}</span>
      </header>
      {total === 0 ? (
        <p className="empty">Todavía no ganaste ningún título.</p>
      ) : (
        <div className="stack">
          {byComp.map(({ k, n }) => (
            <div key={k} className="offer-row">
              <div>
                <strong>
                  {COMPETITION_LABEL[k]} <span className="tag tiny">{n.length}</span>
                </strong>
                <span className="muted small">
                  {n.map((t) => `T${t.season}${t.teamName ?? first?.teamName ? ` (${t.teamName ?? first?.teamName})` : ''}`).join(' · ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Campeones({ game }: { game: GameState }) {
  const me = game.userTeamId;
  const hist = [...game.championsHistory].reverse();
  if (hist.length === 0) {
    return (
      <section className="panel">
        <p className="empty">Todavía no se completó ninguna temporada entera.</p>
      </section>
    );
  }
  const row = (label: string, c: TeamRef | null) => (
    <tr key={label}>
      <td className="left">{label}</td>
      <td className={`left ${c && c.id === me ? 'strong' : ''}`}>{c ? `${c.name}${c.id === me ? ' 🏆' : ''}` : '—'}</td>
    </tr>
  );
  return (
    <div className="stack">
      {hist.map((h) => (
        <section key={h.season} className="panel">
          <header className="panel-head">
            <h2>Temporada {h.season}</h2>
          </header>
          <table className="grid compact">
            <tbody>
              {row('Primera A', h.champA)}
              {row('Primera B', h.champB)}
              {row('Primera C', h.champC)}
              {row('Copa', h.champCup)}
              {row('Copa de Campeones', h.champChampionsCup)}
              {h.champIntl && row('Copa Internacional', h.champIntl)}
            </tbody>
          </table>
          {h.champCupRep && (
            <p className="muted small hint">
              El campeón de Copa ya era campeón de otra categoría, así que en la Copa de Campeones jugó en su lugar {h.champCupRep.name} (2° de Primera A).
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/** Sección del DT: perfil, carrera, ofertas, historial del club, palmarés y campeones. */
export function Dt() {
  const game = useGame((s) => s.game);
  const [sub, setSub] = useState<Sub>('perfil');
  if (!game) return null;
  const SUBS: { id: Sub; label: string }[] = [
    { id: 'perfil', label: 'Perfil' },
    { id: 'ofertas', label: game.dt.jobOffers.length > 0 ? `Ofertas (${game.dt.jobOffers.length})` : 'Ofertas' },
    { id: 'historial', label: 'Historial' },
    { id: 'palmares', label: 'Palmarés' },
    { id: 'campeones', label: 'Campeones' },
  ];
  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="Secciones del DT">
        {SUBS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={sub === x.id} className={sub === x.id ? 'on' : ''} onClick={() => setSub(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {sub === 'perfil' && <Perfil game={game} />}
      {sub === 'ofertas' && <Ofertas game={game} />}
      {sub === 'historial' && <Historial game={game} />}
      {sub === 'palmares' && <Palmares game={game} />}
      {sub === 'campeones' && <Campeones game={game} />}
    </div>
  );
}
