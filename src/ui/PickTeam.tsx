import { useState } from 'react';
import type { DivisionId } from '../domain/types';
import { teamStrength } from '../engine/strength';
import { useGame } from '../store/gameStore';
import { Badge } from './Badge';
import { money } from './format';

const DIVS: DivisionId[] = ['A', 'B', 'C'];

export function PickTeam() {
  const game = useGame((s) => s.game);
  const pickTeam = useGame((s) => s.pickTeam);
  const backToMenu = useGame((s) => s.backToMenu);
  const [div, setDiv] = useState<DivisionId>('C');
  if (!game) return null;
  const teams = game.divisions[div].teams;

  return (
    <main className="page">
      <button type="button" className="back-link" onClick={backToMenu}>
        ← Volver al menú
      </button>
      <h1 className="page-title">Elegí tu equipo</h1>
      <p className="muted">DT {game.dtName}. Empezar en una división baja es un desafío mayor.</p>
      <div className="subtabs" role="group" aria-label="Divisiones">
        {DIVS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === div}
            className={d === div ? 'active' : ''}
            onClick={() => setDiv(d)}
          >
            División {d}
          </button>
        ))}
      </div>
      <ul className="team-list">
        {teams.map((t) => (
          <li key={t.id}>
            <button type="button" className="team-pick" onClick={() => void pickTeam(t.id)}>
              <Badge name={t.name} color={t.color} />
              <span className="tp-name">{t.name}</span>
              <span className="tp-stat">Fuerza {Math.round(teamStrength(t))}</span>
              <span className="price">{money(t.budget)}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
