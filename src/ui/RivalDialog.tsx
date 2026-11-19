// Ficha del rival (HTML 2530-2593): plantel, fuerza, forma reciente e historial; permite ofertar o seguir jugadores.
import { useEffect, useId, useRef, useState } from 'react';
import { clubPrice, marketWindow, windowStatusText } from '../engine/market';
import { getUserRivalId, h2hFor, recentResults } from '../engine/rivalry';
import { findTeam } from '../engine/season';
import { teamStrength } from '../engine/strength';
import { useGame, type MarketNotice } from '../store/gameStore';
import { Badge } from './Badge';
import { BuyButton, PosChip, WatchButton } from './Market';
import { ratingClass } from './format';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function RivalDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const game = useGame((s) => s.game);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<MarketNotice | null>(null);

  // Foco al abrir, Escape cierra, Tab queda dentro del diálogo y el foco vuelve a quien lo abrió.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const opp = game ? findTeam(game, teamId) : undefined;
  if (!game || !opp || !game.userTeamId) return null;

  const h2h = h2hFor(game, game.userTeamId, opp.id);
  const form = recentResults(game, opp.id);
  const isClassic = getUserRivalId(game) === opp.id;
  const w = marketWindow(game);
  const starters = new Set(opp.lineup.filter((id): id is string => !!id));
  const squad = [...opp.squad].sort((a, b) => Number(starters.has(b.id)) - Number(starters.has(a.id)) || b.rating - a.rating);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <Badge name={opp.name} color={opp.color} size="lg" />
          <div className="modal-title">
            <h2 id={titleId}>{opp.name}</h2>
            <span className="muted">
              Fuerza {Math.round(teamStrength(opp))} · {opp.squad.length} jugadores
              {isClassic && <span className="tag danger"> 🔥 Clásico</span>}
            </span>
          </div>
          <button ref={closeRef} type="button" className="btn small" onClick={onClose} aria-label="Cerrar la ficha del rival">
            Cerrar
          </button>
        </header>

        <div className="modal-body">
          <div className="modal-cols">
            <section>
              <h3>Forma reciente</h3>
              {form.length === 0 ? (
                <p className="muted">Todavía no jugó esta temporada.</p>
              ) : (
                <span className="form">
                  {form.map((f, i) => (
                    <span key={i} className={`fpill f-${f.outcome}`} title={`${f.score} vs ${f.rival}`}>
                      {f.outcome}
                    </span>
                  ))}
                </span>
              )}
            </section>
            <section>
              <h3>Historial cara a cara</h3>
              {h2h.played === 0 ? (
                <p className="muted">Todavía no se enfrentaron.</p>
              ) : (
                <p>
                  PJ {h2h.played} · G {h2h.w} · E {h2h.d} · P {h2h.l}
                  <br />
                  <small className="muted">
                    Goles a favor/en contra: {h2h.gf}-{h2h.ga}
                  </small>
                </p>
              )}
            </section>
          </div>

          <h3>Plantel</h3>
          <p className={`muted small ${w.open ? '' : 'warn-text'}`} role="status">
            {w.open ? 'Mercado abierto: podés ofertar.' : `Mercado cerrado: no podés ofertar. ${windowStatusText(w)}`} ⭐ = titular habitual.
          </p>
          {notice && (
            <p className={`alert ${notice.ok ? 'ok' : 'error'}`} role={notice.ok ? 'status' : 'alert'}>
              {notice.message}
            </p>
          )}
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Plantel del rival">
            <table className="grid market">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th className="left">Jugador</th>
                  <th className="num">Edad</th>
                  <th className="num">Act</th>
                  <th className="left">Acción</th>
                </tr>
              </thead>
              <tbody>
                {squad.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <PosChip pos={p.pos} />
                    </td>
                    <td className="left">
                      {p.name}
                      {starters.has(p.id) && (
                        <span title="Titular habitual" role="img" aria-label="Titular habitual">
                          {' '}
                          ⭐
                        </span>
                      )}
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num">
                      <span className={`rating ${ratingClass(p.rating)}`}>{p.rating}</span>
                    </td>
                    <td className="left">
                      <span className="row-actions">
                        <BuyButton game={game} row={{ player: p, club: opp, price: clubPrice(p) }} onNotice={setNotice} />
                        <WatchButton game={game} playerId={p.id} onNotice={setNotice} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
