import { useEffect, useMemo, useRef, useState } from 'react';
import { MATCH } from '../engine/config';
import { findTeam } from '../engine/season';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';

const SPEEDS = [1, 2, 4] as const;
const ICON: Record<string, string> = { goal: '⚽', chance: '•', save: '🧤', foul: '⚠', build: '·' };

export function LiveMatch() {
  const live = useGame((s) => s.live);
  const game = useGame((s) => s.game);
  const busy = useGame((s) => s.busy);
  const finishUserMatch = useGame((s) => s.finishUserMatch);

  const [minute, setMinute] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLUListElement>(null);

  const total = MATCH.minutes;
  const finished = minute >= total;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setMinute((m) => Math.min(total, m + 1)), 1000 / speed);
    return () => window.clearInterval(id);
  }, [speed, finished, total]);

  const events = useMemo(
    () => (live ? [...live.sim.events].sort((a, b) => a.minute - b.minute) : []),
    [live],
  );
  const visible = events.filter((e) => e.minute <= minute);
  const hg = visible.filter((e) => e.type === 'goal' && e.side === 'home').length;
  const ag = visible.filter((e) => e.type === 'goal' && e.side === 'away').length;

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  // Al llegar al final dejamos el foco en el botón de continuar.
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (finished) continueRef.current?.focus();
  }, [finished]);

  if (!live || !game) return null;
  const home = findTeam(game, live.sim.result.homeId);
  const away = findTeam(game, live.sim.result.awayId);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="live-title" ref={dialogRef} tabIndex={-1}>
      <h2 id="live-title" className="sr-only">
        Partido en vivo: {live.homeName} contra {live.awayName}
      </h2>
      <div className="scoreboard">
        <div className="sb-teams">
          <div className="sb-team">
            <Badge name={live.homeName} color={home?.color ?? '#555'} size="lg" />
            <span>{live.homeName}</span>
          </div>
          <div className="sb-score" aria-label={`Marcador ${hg} a ${ag}`}>
            {hg} - {ag}
          </div>
          <div className="sb-team">
            <Badge name={live.awayName} color={away?.color ?? '#555'} size="lg" />
            <span>{live.awayName}</span>
          </div>
        </div>
        <div className="sb-minute">
          {finished ? (
            'Final del partido'
          ) : (
            <>
              <span className="sb-clock-dot" aria-hidden="true" />
              {String(minute).padStart(2, '0')}:00 / {total}:00
            </>
          )}
        </div>
      </div>

      <ul className="feed" ref={feedRef} aria-live="polite" aria-label="Relato del partido">
        {visible.length === 0 && <li className="empty">Arranca el partido…</li>}
        {visible.map((e, i) => (
          <li key={i} className={`feed-item ${e.type}`}>
            <span className="feed-min">{e.minute}'</span>
            <span className="feed-ico" aria-hidden="true">
              {ICON[e.type]}
            </span>
            <span className="feed-text">
              {e.card === 'red' ? 'Roja. ' : e.card === 'yellow' ? 'Amarilla. ' : ''}
              {e.text}
            </span>
          </li>
        ))}
      </ul>

      <div className="match-actions">
        {finished ? (
          <button type="button" className="btn" ref={continueRef} disabled={busy} onClick={() => void finishUserMatch()}>
            Continuar
          </button>
        ) : (
          <div className="row2">
            <div className="speed" role="group" aria-label="Velocidad">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn small ${s === speed ? '' : 'secondary'}`}
                  aria-pressed={s === speed}
                  onClick={() => setSpeed(s)}
                >
                  x{s}
                </button>
              ))}
            </div>
            <button type="button" className="btn ghost small" onClick={() => setMinute(total)}>
              Saltar al final
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
