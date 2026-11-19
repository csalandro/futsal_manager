import type { Formation, Player, Press, Style } from '../domain/types';
import { userTeam } from '../engine/season';
import { unavailableReason } from '../engine/squad';
import { getFullSlots, teamStrength } from '../engine/strength';
import { useGame } from '../store/gameStore';
import { ratingClass } from './format';

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

/** Posición en la cancha (x, y en %; el arco propio abajo) de cada puesto según la formación. */
const COORDS: Record<Formation, [number, number][]> = {
  '2-2': [[50, 88], [28, 64], [72, 64], [28, 32], [72, 32]],
  '4-0': [[50, 88], [14, 50], [38, 56], [62, 56], [86, 50]],
  '1-2-1': [[50, 88], [50, 68], [18, 46], [82, 46], [50, 22]],
  '2-1-1': [[50, 88], [30, 68], [70, 68], [50, 44], [50, 20]],
  '1-1-2': [[50, 88], [50, 68], [50, 46], [30, 22], [70, 22]],
};

function shortName(p: Player) {
  const parts = p.name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : p.name;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg-field">
      <span className="seg-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Tactics() {
  const game = useGame((s) => s.game);
  const setTactic = useGame((s) => s.setTactic);
  const setLineupSlot = useGame((s) => s.setLineupSlot);
  const autoLineup = useGame((s) => s.autoLineup);
  const toggleTaker = useGame((s) => s.togglePenaltyTaker);
  const moveTaker = useGame((s) => s.movePenaltyTaker);
  const team = game ? userTeam(game) : undefined;
  if (!team) return null;

  const slots = getFullSlots(team.tactic.formation);
  const coords = COORDS[team.tactic.formation];
  const players = [...team.squad].sort((a, b) => b.rating - a.rating);
  const byId = new Map(team.squad.map((p) => [p.id, p]));
  const takers = team.penaltyTakers.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const takerCandidates = players.filter((p) => p.pos !== 'POR' && !team.penaltyTakers.includes(p.id));

  return (
    <div className="tactics">
      <section className="panel pitch-panel">
        <header className="panel-head">
          <h2>Formación {team.tactic.formation}</h2>
          <span className="strength-chip" title="Fuerza actual del equipo">
            Fuerza <b>{Math.round(teamStrength(team))}</b>
          </span>
        </header>
        <div className="pitch" role="img" aria-label={`Cancha con la formación ${team.tactic.formation}`}>
          <div className="pitch-lines" aria-hidden="true">
            <i className="half" />
            <i className="circle" />
            <i className="area top" />
            <i className="area bottom" />
          </div>
          {coords.map(([x, y], i) => {
            const p = team.lineup[i] ? byId.get(team.lineup[i]!) : undefined;
            const req = slots[i];
            const out = !!(req && p && p.pos !== req);
            return (
              <div key={i} className={`token${p ? '' : ' empty'}${out ? ' out' : ''}${i === 0 ? ' gk' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}>
                <span className="token-dot">{p ? p.number : '?'}</span>
                <span className="token-name">{p ? shortName(p) : 'Vacío'}</span>
                <span className="token-role">{i === 0 ? 'POR' : req ?? 'Libre'}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="tactics-side">
        <section className="panel">
          <header className="panel-head">
            <h2>Instrucciones</h2>
          </header>
          <div className="stack">
            <Segmented label="Formación" value={team.tactic.formation} options={FORMATIONS.map((f) => ({ id: f, label: f }))} onChange={(v) => setTactic({ formation: v })} />
            <Segmented label="Presión" value={team.tactic.press} options={PRESSES} onChange={(v) => setTactic({ press: v })} />
            <Segmented label="Estilo" value={team.tactic.style} options={STYLES} onChange={(v) => setTactic({ style: v })} />
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Alineación</h2>
          </header>
          <ul className="lineup">
            {slots.map((req, i) => {
              const id = team.lineup[i] ?? null;
              const player = id ? byId.get(id) : undefined;
              const out = !!(req && player && player.pos !== req);
              return (
                <li key={i} className={out ? 'out' : ''}>
                  <span className="lineup-role">{i === 0 ? 'POR' : req ?? `J${i}`}</span>
                  <select aria-label={i === 0 ? 'Arquero' : `Puesto ${i}`} value={id ?? ''} onChange={(e) => setLineupSlot(i, e.target.value || null)}>
                    <option value="">— Vacío —</option>
                    {players.map((p) => {
                      const why = unavailableReason(p);
                      return (
                        <option key={p.id} value={p.id} disabled={!!why && p.id !== id}>
                          {p.pos} · {p.name} ({p.rating}){why ? ` — ${why}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {player && <span className={`rating ${ratingClass(player.rating)}`}>{player.rating}</span>}
                  {player && unavailableReason(player) && (
                    <p className="lineup-warn" role="status">
                      No puede jugar: {unavailableReason(player)!.toLowerCase()}.
                    </p>
                  )}
                  {out && player && (
                    <p className="lineup-warn" role="status">
                      Fuera de posición: es {player.pos}, el puesto pide {req}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn small" onClick={autoLineup}>
              Autocompletar alineación
            </button>
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Pateadores de penales</h2>
            <span className="panel-meta">{takers.length}/5</span>
          </header>
          <p className="muted">Elegí el orden de hasta 5. Si no elegís a nadie, patean los de mejor nivel que estén en cancha.</p>
          <ol className="taker-list" aria-label="Orden de pateadores">
            {takers.map((p, i) => (
              <li key={p.id}>
                <span className="grow">
                  {i + 1}. {p.name} <small className="muted">({p.rating})</small>
                </span>
                <button type="button" className="btn small ghost" aria-label={`Subir a ${p.name}`} disabled={i === 0} onClick={() => moveTaker(p.id, -1)}>
                  ▲
                </button>
                <button type="button" className="btn small ghost" aria-label={`Bajar a ${p.name}`} disabled={i === takers.length - 1} onClick={() => moveTaker(p.id, 1)}>
                  ▼
                </button>
                <button type="button" className="btn small ghost danger-text" onClick={() => toggleTaker(p.id)}>
                  Quitar
                </button>
              </li>
            ))}
          </ol>
          {takers.length < 5 && takerCandidates.length > 0 && (
            <label className="seg-field" style={{ marginTop: 10 }}>
              <span className="seg-label">Agregar pateador</span>
              <select
                value=""
                aria-label="Agregar pateador"
                onChange={(e) => e.target.value && toggleTaker(e.target.value)}
              >
                <option value="">— Elegir jugador —</option>
                {takerCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.rating})
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      </div>
    </div>
  );
}
