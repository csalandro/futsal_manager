import { useState } from 'react';
import type { GameState, Player, Position, Team } from '../domain/types';
import { MARKET, SQUAD } from '../engine/config';
import {
  acceptChanceFor, buyBlocker, clubPrice, findPlayer, freeAgentPrice, isWatched, marketWindow, offerBlocker, scoutedPotential,
  windowStatusText,
} from '../engine/market';
import { findTeam, userTeam } from '../engine/season';
import { sellBlocker } from '../engine/squad';
import { useGame, type MarketNotice } from '../store/gameStore';
import { FinanceAlert } from './Club';
import { money, ratingClass } from './format';

type Sub = 'comprar' | 'vender' | 'cartera';
type PosFilter = 'todas' | Position;
type SortKey = 'precio-asc' | 'precio-desc' | 'rating' | 'potencial';
type Origin = 'todos' | 'libres' | 'clubes';

const POS_LABEL: Record<Position, string> = { POR: 'Arquero', CIE: 'Cierre', ALA: 'Ala', PIV: 'Pívot' };

/** Potencial: real con ojeadores; con rango estimado si no hay. */
export function Potential({ p, scouts }: { p: Player; scouts: number }) {
  const v = scoutedPotential(p, scouts);
  if (v.exact) return <span className={`rating ghost ${ratingClass(p.potential)}`}>{p.potential}</span>;
  return (
    <span className="rating ghost muted" title="Estimado: con un ojeador en el staff ves el potencial real.">
      {v.min}–{v.max}
    </span>
  );
}

export function PosChip({ pos }: { pos: Position }) {
  return (
    <span className={`pos pos-${pos.toLowerCase()}`} title={POS_LABEL[pos]}>
      {pos}
    </span>
  );
}

function Banner({ game, team }: { game: GameState; team: Team }) {
  const w = marketWindow(game);
  return (
    <div className={`market-status ${w.open ? 'open' : 'closed'}`} role="status">
      <strong>{w.open ? 'Mercado abierto' : 'Mercado cerrado'}</strong>
      <span>{windowStatusText(w)}</span>
      <span className="muted">Ventanas: pretemporada y fechas {MARKET.windows.map((x) => `${x.from} a ${x.to}`).join(' y ')}.</span>
      <span className="market-budget">
        <b>Presupuesto {money(team.budget)}</b> · {team.squad.length}/{SQUAD.max} jugadores
      </span>
    </div>
  );
}

interface Row {
  player: Player;
  club: Team | null;
  price: number;
}

export function BuyButton({ game, row, onNotice }: { game: GameState; row: Row; onNotice: (n: MarketNotice) => void }) {
  const buy = useGame((s) => s.buyPlayer);
  const blocker = buyBlocker(game, row.player.id);
  return (
    <button
      type="button"
      className={`btn small ${blocker ? '' : 'primary'}`}
      disabled={blocker !== null}
      title={blocker ?? `Ofertar ${money(row.price)}`}
      onClick={() => onNotice(buy(row.player.id))}
    >
      Fichar {money(row.price)}
    </button>
  );
}

export function WatchButton({ game, playerId, onNotice }: { game: GameState; playerId: string; onNotice: (n: MarketNotice) => void }) {
  const toggle = useGame((s) => s.toggleWatch);
  const on = isWatched(game, playerId);
  return (
    <button
      type="button"
      className="btn small ghost"
      aria-pressed={on}
      title={on ? 'Quitar de la cartera' : 'Seguir en la cartera'}
      onClick={() => onNotice(toggle(playerId))}
    >
      {on ? '★ En cartera' : '☆ Seguir'}
    </button>
  );
}

function PosSelect({ value, onChange }: { value: PosFilter; onChange: (p: PosFilter) => void }) {
  return (
    <label className="field inline">
      <span>Posición</span>
      <select value={value} onChange={(e) => onChange(e.target.value as PosFilter)}>
        <option value="todas">Todas</option>
        {(Object.keys(POS_LABEL) as Position[]).map((p) => (
          <option key={p} value={p}>
            {POS_LABEL[p]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Comprar({ game, team, onNotice }: { game: GameState; team: Team; onNotice: (n: MarketNotice) => void }) {
  const [pos, setPos] = useState<PosFilter>('todas');
  const [origin, setOrigin] = useState<Origin>('todos');
  const [sort, setSort] = useState<SortKey>('rating');
  const w = marketWindow(game);

  if (!w.open) {
    return (
      <section className="panel">
        <div className="closed-card">
          <span aria-hidden="true" className="closed-ico">
            🔒
          </span>
          <h2>El mercado está cerrado</h2>
          <p className="muted">{windowStatusText(w)} Podés seguir jugadores en la Cartera y ficharlos cuando abra.</p>
        </div>
      </section>
    );
  }

  const m = game.market;
  const rows: Row[] = [];
  if (origin !== 'clubes') for (const p of m.freeAgents) rows.push({ player: p, club: null, price: freeAgentPrice(p) });
  if (origin !== 'libres') {
    for (const e of m.clubListings) {
      const f = findPlayer(game, e.playerId);
      if (f?.team) rows.push({ player: f.player, club: f.team, price: clubPrice(f.player) });
    }
  }
  const shown = rows
    .filter((r) => pos === 'todas' || r.player.pos === pos)
    .sort((a, b) => {
      switch (sort) {
        case 'precio-asc':
          return a.price - b.price;
        case 'precio-desc':
          return b.price - a.price;
        case 'potencial':
          return b.player.potential - a.player.potential || b.player.rating - a.player.rating;
        default:
          return b.player.rating - a.player.rating || a.price - b.price;
      }
    });

  return (
    <section className="panel flush">
      <header className="panel-head">
        <h2>Comprar</h2>
        <span className="panel-meta">{shown.length} jugadores</span>
      </header>
      <div className="filters">
        <PosSelect value={pos} onChange={setPos} />
        <label className="field inline">
          <span>Origen</span>
          <select value={origin} onChange={(e) => setOrigin(e.target.value as Origin)}>
            <option value="todos">Todos</option>
            <option value="libres">Agentes libres</option>
            <option value="clubes">Otros clubes</option>
          </select>
        </label>
        <label className="field inline">
          <span>Orden</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="rating">Mejor rating</option>
            <option value="potencial">Mayor potencial</option>
            <option value="precio-asc">Precio: menor a mayor</option>
            <option value="precio-desc">Precio: mayor a menor</option>
          </select>
        </label>
      </div>
      {team.staff.scouts < MARKET.scoutsToReveal && (
        <p className="muted small hint pad">
          Sin ojeadores ves un rango estimado del potencial. Contratá uno en Club, Empleados, para ver el real.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="empty">No hay jugadores con ese filtro.</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Jugadores en venta">
          <table className="grid market">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="left sticky">Jugador</th>
                <th className="num">Edad</th>
                <th className="num">Act</th>
                <th className="num">Pot</th>
                <th className="left">Origen</th>
                <th className="left">Acción</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ player: p, club, price }) => {
                const hard = acceptChanceFor(game, p.id) < MARKET.hardSellBelow;
                return (
                  <tr key={p.id}>
                    <td>
                      <PosChip pos={p.pos} />
                    </td>
                    <td className="left sticky">
                      <span className="pname">{p.name}</span>
                      {hard && (
                        <span className="tag tiny warn" title="Juega en un nivel más alto: es probable que rechace la oferta.">
                          Difícil de convencer
                        </span>
                      )}
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num">
                      <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>
                    </td>
                    <td className="num">
                      <Potential p={p} scouts={team.staff.scouts} />
                    </td>
                    <td className="left">{club ? club.name : 'Agente libre'}</td>
                    <td className="left">
                      <span className="row-actions">
                        <BuyButton game={game} row={{ player: p, club, price }} onNotice={onNotice} />
                        {club && <WatchButton game={game} playerId={p.id} onNotice={onNotice} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Vender({ game, team, onNotice }: { game: GameState; team: Team; onNotice: (n: MarketNotice) => void }) {
  const accept = useGame((s) => s.acceptOffer);
  const reject = useGame((s) => s.rejectOffer);
  const toggle = useGame((s) => s.toggleTransferListed);
  const [pos, setPos] = useState<PosFilter>('todas');
  const [sort, setSort] = useState<SortKey>('rating');
  const offers = game.market.offers;
  const squad = team.squad
    .filter((p) => pos === 'todas' || p.pos === pos)
    .sort((a, b) => {
      switch (sort) {
        case 'precio-asc':
          return a.value - b.value;
        case 'precio-desc':
          return b.value - a.value;
        case 'potencial':
          return b.potential - a.potential;
        default:
          return b.rating - a.rating;
      }
    });

  return (
    <div className="stack">
      <section className="panel flush">
        <header className="panel-head">
          <h2>Ofertas por tus jugadores</h2>
          <span className="panel-meta">{offers.length}</span>
        </header>
        {offers.length === 0 ? (
          <p className="empty">
            No hay ofertas. Marcá jugadores como transferibles: durante las ventanas, otros clubes pueden ofertar por ellos.
          </p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Ofertas recibidas">
            <table className="grid market">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th className="left sticky">Jugador</th>
                  <th className="num">Act</th>
                  <th className="left">Club</th>
                  <th className="num">Oferta</th>
                  <th className="left">Acción</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const p = team.squad.find((x) => x.id === o.playerId);
                  const club = findTeam(game, o.teamId);
                  if (!p || !club) return null;
                  const blocker = offerBlocker(game, o);
                  return (
                    <tr key={`${o.playerId}-${o.teamId}`}>
                      <td>
                        <PosChip pos={p.pos} />
                      </td>
                      <td className="left sticky">
                        <span className="pname">{p.name}</span>
                      </td>
                      <td className="num">
                        <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>
                      </td>
                      <td className="left">{club.name}</td>
                      <td className="num strong">{money(o.price)}</td>
                      <td className="left">
                        <span className="row-actions">
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={blocker !== null}
                            title={blocker ?? 'Aceptar la oferta'}
                            onClick={() => onNotice(accept(o.playerId, o.teamId))}
                          >
                            Aceptar
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => reject(o.playerId, o.teamId)}>
                            Rechazar
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel flush">
        <header className="panel-head">
          <h2>Tu plantel</h2>
          <span className="panel-meta">{team.squad.filter((p) => p.transferListed).length} transferibles</span>
        </header>
        <p className="muted small hint pad">
          Un jugador solo sale si lo marcás como transferible y otro club te hace una oferta (solo en las ventanas), o si lo despedís pagando la
          indemnización. No se puede vender dejando menos de {SQUAD.minAfterFire + 1} jugadores ni sin arquero.
        </p>
        <div className="filters">
          <PosSelect value={pos} onChange={setPos} />
          <label className="field inline">
            <span>Orden</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="rating">Mejor rating</option>
              <option value="potencial">Mayor potencial</option>
              <option value="precio-desc">Valor: mayor a menor</option>
              <option value="precio-asc">Valor: menor a mayor</option>
            </select>
          </label>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Tu plantel en el mercado">
          <table className="grid market">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="left sticky">Jugador</th>
                <th className="num">Edad</th>
                <th className="num">Act</th>
                <th className="num">Pot</th>
                <th className="num">Valor</th>
                <th className="num hide-sm">Contr.</th>
                <th className="left">Transferible</th>
              </tr>
            </thead>
            <tbody>
              {squad.map((p) => {
                const blocked = sellBlocker(team, p);
                return (
                  <tr key={p.id}>
                    <td>
                      <PosChip pos={p.pos} />
                    </td>
                    <td className="left sticky">
                      <span className="pname">{p.name}</span>
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num">
                      <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>
                    </td>
                    <td className="num">
                      <span className={`rating ghost ${ratingClass(p.potential)}`}>{p.potential}</span>
                    </td>
                    <td className="num">{money(p.value)}</td>
                    <td className="num hide-sm">{p.contractYears}a</td>
                    <td className="left">
                      <button
                        type="button"
                        className={`btn small ${p.transferListed ? '' : 'ghost'}`}
                        aria-pressed={!!p.transferListed}
                        title={blocked && !p.transferListed ? `No recibiría ofertas ahora: ${blocked}` : undefined}
                        onClick={() => onNotice(toggle(p.id))}
                      >
                        {p.transferListed ? '📢 Transferible' : 'Marcar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Cartera({ game, team, onNotice }: { game: GameState; team: Team; onNotice: (n: MarketNotice) => void }) {
  const [pos, setPos] = useState<PosFilter>('todas');
  const rows = game.watchlist.flatMap((e) => {
    const found = findPlayer(game, e.playerId);
    if (!found?.team || (pos !== 'todas' && found.player.pos !== pos)) return [];
    return [{ e, player: found.player, club: found.team }];
  });

  return (
    <section className="panel flush">
      <header className="panel-head">
        <h2>Cartera de seguimiento</h2>
        <span className="panel-meta">{game.watchlist.length} jugadores</span>
      </header>
      <p className="muted small hint pad">
        Jugadores de otros clubes que fuiste marcando (desde Comprar o desde la ficha del rival). Podés ficharlos cuando el mercado esté abierto.
      </p>
      <div className="filters">
        <PosSelect value={pos} onChange={setPos} />
      </div>
      {rows.length === 0 ? (
        <p className="empty">Todavía no seguís a nadie.</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Jugadores seguidos">
          <table className="grid market">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="left sticky">Jugador</th>
                <th className="left">Club</th>
                <th className="num">Edad</th>
                <th className="num" title="Rating al agregarlo, y ahora">
                  Evolución
                </th>
                <th className="num">Pot</th>
                <th className="num hide-sm">Forma</th>
                <th className="left">Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, player: p, club }) => {
                const delta = p.rating - e.since.rating;
                return (
                  <tr key={e.playerId}>
                    <td>
                      <PosChip pos={p.pos} />
                    </td>
                    <td className="left sticky">
                      <span className="pname">{p.name}</span>
                    </td>
                    <td className="left">{club.name}</td>
                    <td className="num">{p.age}</td>
                    <td className="num" title={e.history.map((h) => `Temp. ${h.season}: ${h.rating}`).join(' · ')}>
                      {e.since.rating} → <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>{' '}
                      <small className={delta > 0 ? 'up' : delta < 0 ? 'down' : 'muted'}>{delta > 0 ? `+${delta}` : delta}</small>
                    </td>
                    <td className="num">
                      <Potential p={p} scouts={team.staff.scouts} />
                    </td>
                    <td className={`num hide-sm ${p.form > 0 ? 'up' : p.form < 0 ? 'down' : 'muted'}`}>
                      {p.form > 0 ? `+${p.form}` : p.form}
                    </td>
                    <td className="left">
                      <span className="row-actions">
                        <BuyButton game={game} row={{ player: p, club, price: clubPrice(p) }} onNotice={onNotice} />
                        <WatchButton game={game} playerId={p.id} onNotice={onNotice} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Market() {
  const game = useGame((s) => s.game);
  const [sub, setSub] = useState<Sub>('comprar');
  const [notice, setNotice] = useState<MarketNotice | null>(null);
  const team = game ? userTeam(game) : undefined;
  if (!game || !team) return null;

  const SUBS: { id: Sub; label: string }[] = [
    { id: 'comprar', label: 'Comprar' },
    { id: 'vender', label: game.market.offers.length > 0 ? `Vender y ofertas (${game.market.offers.length})` : 'Vender y ofertas' },
    { id: 'cartera', label: game.watchlist.length > 0 ? `Cartera (${game.watchlist.length})` : 'Cartera' },
  ];

  return (
    <div className="stack">
      <FinanceAlert team={team} />
      <Banner game={game} team={team} />
      <div className="segmented" role="tablist" aria-label="Secciones del mercado">
        {SUBS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={sub === x.id}
            className={sub === x.id ? 'on' : ''}
            onClick={() => {
              setSub(x.id);
              setNotice(null);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      {notice && (
        <p className={`alert ${notice.ok ? 'ok' : 'error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.message}
        </p>
      )}
      {sub === 'comprar' && <Comprar game={game} team={team} onNotice={setNotice} />}
      {sub === 'vender' && <Vender game={game} team={team} onNotice={setNotice} />}
      {sub === 'cartera' && <Cartera game={game} team={team} onNotice={setNotice} />}
    </div>
  );
}
