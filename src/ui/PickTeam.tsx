import { useState } from 'react';
import type { DivisionId } from '../domain/types';
import { teamStrength } from '../engine/strength';
import { useGame } from '../store/gameStore';
import { AppHeader } from './AppHeader';
import { Badge } from './Badge';
import { money } from './format';
import { IconBack } from './icons';

const DIVS: { id: DivisionId; label: string; hint: string }[] = [
  { id: 'A', label: 'División A', hint: 'Elite: pelear el título' },
  { id: 'B', label: 'División B', hint: 'Intermedia' },
  { id: 'C', label: 'División C', hint: 'Desafío: empezar desde abajo' },
];

export function PickTeam() {
  const game = useGame((s) => s.game);
  const busy = useGame((s) => s.busy);
  const pickTeam = useGame((s) => s.pickTeam);
  const backToMenu = useGame((s) => s.backToMenu);
  const [div, setDiv] = useState<DivisionId>('C');
  if (!game) return null;
  const teams = [...game.divisions[div].teams].sort((a, b) => teamStrength(b) - teamStrength(a));
  const max = Math.max(...teams.map((t) => teamStrength(t)));

  return (
    <div className="page">
      <AppHeader />
      <main className="page-body">
        <button type="button" className="link back" onClick={backToMenu}>
          <IconBack size={16} /> Mis partidas
        </button>
        <div className="page-intro">
          <h1>Elegí tu club</h1>
          <p className="muted">DT {game.dtName}. Cuanto más abajo empieces, más largo el camino a la gloria.</p>
        </div>
        <div className="segmented wide" role="group" aria-label="Divisiones">
          {DIVS.map((d) => (
            <button key={d.id} type="button" aria-pressed={d.id === div} className={d.id === div ? 'on' : ''} onClick={() => setDiv(d.id)}>
              <b>{d.label}</b>
              <small>{d.hint}</small>
            </button>
          ))}
        </div>
        <ul className="club-grid">
          {teams.map((t) => {
            const s = teamStrength(t);
            return (
              <li key={t.id}>
                <button type="button" className="club-card" disabled={busy} onClick={() => void pickTeam(t.id)} style={{ '--club': t.color } as React.CSSProperties}>
                  <Badge name={t.name} color={t.color} size="lg" />
                  <span className="club-info">
                    <strong>{t.name}</strong>
                    <span className="muted small">{t.stadium.name}</span>
                  </span>
                  <span className="club-stats">
                    <span className="club-strength">
                      <span className="meter slim">
                        <i className="good" style={{ width: `${Math.round((s / max) * 100)}%` }} />
                      </span>
                      <small>Fuerza {Math.round(s)}</small>
                    </span>
                    <span className="club-budget">{money(t.budget)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
