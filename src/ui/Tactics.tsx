import type { Formation, Press, Style } from '../domain/types';
import { userTeam } from '../engine/season';
import { getFullSlots, teamStrength } from '../engine/strength';
import { useGame } from '../store/gameStore';

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

export function Tactics() {
  const game = useGame((s) => s.game);
  const setTactic = useGame((s) => s.setTactic);
  const setLineupSlot = useGame((s) => s.setLineupSlot);
  const team = game ? userTeam(game) : undefined;
  if (!team) return null;

  const slots = getFullSlots(team.tactic.formation);
  const players = [...team.squad].sort((a, b) => b.rating - a.rating);

  return (
    <section>
      <div className="card strength">
        <span className="hero-label">Fuerza actual del equipo</span>
        <span className="strength-value">{Math.round(teamStrength(team))}</span>
      </div>

      <div className="card">
        <h2 className="section-title">Táctica</h2>
        <label className="field">
          <span>Formación</span>
          <select value={team.tactic.formation} onChange={(e) => setTactic({ formation: e.target.value as Formation })}>
            {FORMATIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Presión</span>
          <select value={team.tactic.press} onChange={(e) => setTactic({ press: e.target.value as Press })}>
            {PRESSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Estilo</span>
          <select value={team.tactic.style} onChange={(e) => setTactic({ style: e.target.value as Style })}>
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h2 className="section-title">Alineación</h2>
        <ul className="lineup">
          {slots.map((req, i) => {
            const id = team.lineup[i] ?? null;
            const player = id ? team.squad.find((p) => p.id === id) : undefined;
            const out = !!(req && player && player.pos !== req);
            return (
              <li key={i} className={`lineup-slot${out ? ' out' : ''}`}>
                <label className="field">
                  <span>
                    {i === 0 ? 'Arquero' : `Puesto ${i}`} · {req ?? 'Libre'}
                  </span>
                  <select value={id ?? ''} onChange={(e) => setLineupSlot(i, e.target.value || null)}>
                    <option value="">Vacío</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.pos} · {p.rating}
                      </option>
                    ))}
                  </select>
                </label>
                {out && player && (
                  <p className="warn" role="status">
                    Fuera de posición: es {player.pos} y se necesita {req}. Penaliza la fuerza del equipo.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
