import { useEffect, useMemo, useRef, useState } from 'react';
import { MATCH } from '../engine/config';
import { findTeam, userTeam } from '../engine/season';
import type { Formation, Press, Style } from '../domain/types';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';

const SPEEDS = [1, 2, 4] as const;
const ICON: Record<string, string> = { goal: '⚽', chance: '◎', save: '🧤', foul: '!', build: '·', injury: '🚑' };
const FORMATIONS: Formation[] = ['2-2', '4-0', '1-2-1', '2-1-1', '1-1-2'];
const PRESSES: { id: Press; label: string }[] = [
  { id: 'baja', label: 'Baja' },
  { id: 'media', label: 'Media' },
  { id: 'alta', label: 'Alta' },
];
const STYLES: { id: Style; label: string }[] = [
  { id: 'equilibrado', label: 'Equilibrado' },
  { id: 'posesion', label: 'Posesión' },
  { id: 'contragolpe', label: 'Contragolpe' },
];
const HALF = MATCH.minutes / 2;

export function LiveMatch() {
  const live = useGame((s) => s.live);
  const game = useGame((s) => s.game);
  const busy = useGame((s) => s.busy);
  const finishUserMatch = useGame((s) => s.finishUserMatch);
  const resumeSecondHalf = useGame((s) => s.resumeSecondHalf);
  const setTactic = useGame((s) => s.setTactic);

  const [minute, setMinute] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLOListElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  const secondHalf = !!live?.sim;
  // Primer tiempo: el reloj frena en el entretiempo hasta que el DT juega el segundo.
  const total = secondHalf ? MATCH.minutes : HALF;
  const atHalftime = !secondHalf && minute >= HALF;
  const finished = secondHalf && minute >= MATCH.minutes;
  const clockStopped = minute >= total;

  useEffect(() => {
    dialogRef.current?.focus();
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, []);

  useEffect(() => {
    if (clockStopped) return;
    const id = window.setInterval(() => setMinute((m) => Math.min(total, m + 1)), 1000 / speed);
    return () => window.clearInterval(id);
  }, [speed, clockStopped, total]);

  const events = useMemo(
    () => (live ? [...(live.sim ? live.sim.events : live.half1.events)].sort((a, b) => a.minute - b.minute) : []),
    [live],
  );
  const visible = events.filter((e) => e.minute <= minute);
  const count = (side: 'home' | 'away', ...types: string[]) => visible.filter((e) => e.side === side && types.includes(e.type)).length;
  const hg = count('home', 'goal');
  const ag = count('away', 'goal');

  // Lo más nuevo arriba: el feed se lee de arriba hacia abajo sin tener que scrollear.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0 });
  }, [visible.length]);

  useEffect(() => {
    if (finished || atHalftime) continueRef.current?.focus();
  }, [finished, atHalftime]);

  if (!live || !game) return null;
  const home = findTeam(game, live.homeId);
  const away = findTeam(game, live.awayId);
  const me = userTeam(game);
  const homeColor = home?.color ?? '#556';
  const awayColor = away?.color ?? '#556';

  const stats: { label: string; h: number; a: number }[] = [
    { label: 'Remates', h: count('home', 'goal', 'chance', 'save'), a: count('away', 'goal', 'chance', 'save') },
    { label: 'Al arco', h: count('home', 'goal', 'save'), a: count('away', 'goal', 'save') },
    { label: 'Faltas', h: count('home', 'foul'), a: count('away', 'foul') },
    {
      label: 'Tarjetas',
      h: visible.filter((e) => e.side === 'home' && e.card).length,
      a: visible.filter((e) => e.side === 'away' && e.card).length,
    },
  ];

  return (
    <div className="match-screen" role="dialog" aria-modal="true" aria-labelledby="live-title" ref={dialogRef} tabIndex={-1}>
      <h2 id="live-title" className="sr-only">
        Partido en vivo: {live.homeName} contra {live.awayName}
      </h2>

      <header className="scorebar" style={{ '--home': homeColor, '--away': awayColor } as React.CSSProperties}>
        <div className="sb-side home">
          <Badge name={live.homeName} color={homeColor} size="lg" />
          <span className="sb-name">{live.homeName}</span>
        </div>
        <div className="sb-center">
          <div className="sb-score" aria-label={`Marcador ${hg} a ${ag}`}>
            <span>{hg}</span>
            <i>-</i>
            <span>{ag}</span>
          </div>
          <div className={`sb-clock${finished ? ' ft' : ''}`}>
            {finished ? 'FINAL' : atHalftime ? 'ENTRETIEMPO' : `${String(minute).padStart(2, '0')}'`}
          </div>
        </div>
        <div className="sb-side away">
          <span className="sb-name">{live.awayName}</span>
          <Badge name={live.awayName} color={awayColor} size="lg" />
        </div>
        <div className="sb-progress" aria-hidden="true">
          <i style={{ width: `${(minute / MATCH.minutes) * 100}%` }} />
        </div>
      </header>

      <div className="match-body">
        <section className="panel match-feed">
          <header className="panel-head">
            <h2>Relato</h2>
          </header>
          <ol className="feed" ref={feedRef} aria-live="polite" aria-label="Relato del partido">
            {visible.length === 0 && <li className="empty">Arranca el partido…</li>}
            {[...visible].reverse().map((e, i) => (
              <li key={visible.length - i} className={`feed-item ${e.type} ${e.side}`}>
                <span className="feed-min">{e.minute}'</span>
                <span className="feed-ico" aria-hidden="true">
                  {e.card === 'red' ? '🟥' : e.card === 'yellow' ? '🟨' : ICON[e.type]}
                </span>
                <span className="feed-text">{e.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel match-stats">
          <header className="panel-head">
            <h2>Estadísticas</h2>
          </header>
          <ul className="stat-rows">
            {stats.map((s) => {
              const sum = s.h + s.a || 1;
              return (
                <li key={s.label}>
                  <div className="stat-line">
                    <b>{s.h}</b>
                    <span>{s.label}</span>
                    <b>{s.a}</b>
                  </div>
                  <div className="stat-bar" style={{ '--home': homeColor, '--away': awayColor } as React.CSSProperties}>
                    <i className="h" style={{ flexGrow: s.h / sum }} />
                    <i className="a" style={{ flexGrow: s.a / sum }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {atHalftime && me && (
        <section className="panel halftime" aria-labelledby="ht-title">
          <header className="panel-head">
            <h2 id="ht-title">Entretiempo: {hg} - {ag}</h2>
          </header>
          <p className="muted">¿Cambiás algo para el segundo tiempo?</p>
          <div className="ht-fields">
            <label>
              Formación
              <select value={me.tactic.formation} onChange={(e) => setTactic({ formation: e.target.value as Formation })}>
                {FORMATIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Presión
              <select value={me.tactic.press} onChange={(e) => setTactic({ press: e.target.value as Press })}>
                {PRESSES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estilo
              <select value={me.tactic.style} onChange={(e) => setTactic({ style: e.target.value as Style })}>
                {STYLES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      <footer className="match-controls">
        {atHalftime ? (
          <button type="button" className="btn continue" ref={continueRef} onClick={resumeSecondHalf}>
            Jugar segundo tiempo
          </button>
        ) : finished ? (
          <button type="button" className="btn continue" ref={continueRef} disabled={busy} onClick={() => void finishUserMatch()}>
            Continuar
          </button>
        ) : (
          <>
            <div className="segmented" role="group" aria-label="Velocidad">
              {SPEEDS.map((s) => (
                <button key={s} type="button" className={s === speed ? 'on' : ''} aria-pressed={s === speed} onClick={() => setSpeed(s)}>
                  x{s}
                </button>
              ))}
            </div>
            <button type="button" className="btn ghost" onClick={() => setMinute(total)}>
              {secondHalf ? 'Ir al final' : 'Ir al entretiempo'}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
